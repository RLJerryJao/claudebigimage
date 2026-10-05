import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PastedImage } from '../types'
import { clampLimits, fitColumn, fitRow, imageNumbers, paneRequest, pngSize } from './layout'
import type { Limits, Size } from './layout'

// Pasting an image raises no prompt.edit (the tag only shows up on the next keystroke),
// so the draft is polled instead.
const POLL_MS = 200

const PANE = 'image-preview'
const COMMAND = 'image-view'

const images = atom({ plugin: 'image-view', key: 'images' } as const, [] as PastedImage[])
const paneShown = atom({ plugin: 'image-view', key: 'paneShown' } as const, false)

let tmpRoot: string | undefined
let found: { sessionId: string; dir: string } | undefined
// The image numbers last drawn, so an unchanged draft doesn't rewrite state; undefined
// while a drawn image's file is still missing, so the next poll looks again.
let shownKey: string | undefined
let isChecking = false
// Only the terminal draws pictures; elsewhere the band and the pane stay out of the way.
let isTerminal = false
// The images the person closed the pane over, so it stays closed until they change.
let dismissedKey: string | undefined
// Whether the person has been told, once a session, how to open a pane the terminal was too narrow for.
let isHinted = false
const sizes = new Map<string, Size | null>()

// Claude Code caches each paste as <tmp>/<project>/<session>/images/<n>.png. The project
// folder is named after a working directory that may since have moved, so find it by the
// session id instead of rebuilding it.
async function imagesDir($: EngineInterface): Promise<string | undefined> {
  const sessionId = await $.session.id()
  if (found?.sessionId === sessionId) return found.dir
  if (tmpRoot === undefined) {
    const fromEnv = await $.env.get('CLAUDE_CODE_TMPDIR')
    // Windows has no /tmp or `id`; Claude Code caches under %TEMP%\claude there.
    const winTemp = fromEnv === undefined && (await $.env.get('OS')) === 'Windows_NT' ? await $.env.get('TEMP') : undefined
    tmpRoot =
      fromEnv ??
      (winTemp !== undefined
        ? `${winTemp.replace(/\\/g, '/')}/claude`
        : `/tmp/claude-${(await $.process.run(['id', '-u'])).stdout.trim()}`)
  }
  const entries = await $.fs.list(tmpRoot).catch(() => [])
  for (const entry of entries) {
    const dir = `${tmpRoot}/${entry.name}/${sessionId}/images`
    if (entry.kind === 'dir' && (await $.fs.exists(dir))) {
      found = { sessionId, dir }
      return dir
    }
  }
  return undefined
}

async function describe($: EngineInterface, dir: string | undefined, n: number): Promise<PastedImage> {
  const path = `${dir}/${n}.png`
  if (dir === undefined || !(await $.fs.exists(path))) return { n, path: null, size: null }
  if (!sizes.has(path)) {
    const head = await $.fs.read(path, { as: 'bytes' }).then(
      ({ base64 }) => pngSize(base64),
      () => undefined, // too big to read: still drawable, just without its aspect ratio
    )
    if (head === null) return { n, path: null, size: null }
    sizes.set(path, head ?? null)
  }
  return { n, path, size: sizes.get(path) ?? null }
}

async function show($: EngineInterface, draft: string, limits: Limits) {
  const numbers = imageNumbers(draft)
  const key = numbers.join(',')
  if (key === shownKey) return
  const dir = numbers.length > 0 ? await imagesDir($) : undefined
  const list: PastedImage[] = []
  for (const n of numbers) list.push(await describe($, dir, n))
  shownKey = list.every(image => image.path !== null) ? key : undefined
  await update($, images, () => list)
  await syncPane($, key, list, limits)
}

/** Opens the preview pane over pasted images and closes it once the draft has none. */
async function syncPane($: EngineInterface, key: string, list: PastedImage[], limits: Limits) {
  if (!isTerminal) return
  if (list.length === 0) {
    dismissedKey = undefined
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) await $.ui.close({ id: PANE })
    await update($, paneShown, () => false)
    return
  }
  if (key === dismissedKey) return
  await openPane($, list, limits)
}

async function openPane($: EngineInterface, list: PastedImage[], limits: Limits) {
  const want = paneRequest(list.map(image => image.size), limits)
  const opened = await $.ui.open({ id: PANE, title: 'Image preview', rows: want.rows, columns: want.columns })
  await update($, paneShown, () => opened.isPlaced)
  if (!opened.isPlaced && !isHinted) {
    isHinted = true
    $.ui.toast(`image-view: run /${COMMAND} for a big preview (the terminal is too narrow to open it by itself)`)
  }
}

// A pane opened while the terminal was too narrow seats itself once it widens; follow it.
async function followPane($: EngineInterface) {
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  const isShown = pane?.isPlaced === true
  if (isShown !== (await read($, paneShown))) await update($, paneShown, () => isShown)
}

async function check($: EngineInterface, limits: Limits) {
  if (isChecking) return
  isChecking = true
  try {
    await show($, (await $.prompt.read()).text, limits)
    if (isTerminal && shownKey !== '') await followPane($)
  } finally {
    isChecking = false
  }
}

export const register: Register = (on, options) => {
  const limits = clampLimits(options.maxHeight, options.maxWidth)

  on('session.start', async ($, e, next) => {
    isTerminal = e.surface === 'terminal'
    await $.command.register({ name: COMMAND, description: 'Show the images pasted into the prompt in a large preview pane' })
    $.clock.every(POLL_MS, () => check($, limits))
    return next(e)
  })

  // Asked for, the pane seats at any terminal width.
  on('command.run', { command: COMMAND }, async $ => {
    const list = await read($, images)
    if (list.length === 0) return { text: 'No pasted images in the prompt to preview.' }
    dismissedKey = undefined
    await openPane($, list, limits)
    return { text: 'Image preview opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      if (e.origin.kind === 'person') dismissedKey = (await read($, images)).map(image => image.n).join(',')
      await update($, paneShown, () => false)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, images)
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>{list.map(image => `[Image #${image.n}]`).join(' ') || 'No pasted images.'}</Text>
    }
    const { Box, Image, Text } = $.ui.resolve(e)
    if (list.length === 0) return <Text dimColor>No pasted images.</Text>
    const cells = fitColumn(list.map(image => image.size), e.props.scroll.bodyRows, e.props.bodyColumns, limits)
    return (
      <Box flexDirection="column" alignItems="center">
        {list.map((image, i) => {
          const { columns, rows } = cells[i] ?? { columns: 4, rows: 1 }
          return (
            <Box flexDirection="column" alignItems="center">
              {image.path === null ? (
                <Box width={columns} height={rows} alignItems="center" justifyContent="center">
                  <Text dimColor wrap="truncate">no preview</Text>
                </Box>
              ) : (
                <Image
                  key={`pane-image-${image.n}`}
                  source={{ file: image.path, format: 'png' }}
                  columns={columns}
                  rows={rows}
                  alt={`[Image #${image.n}]`}
                />
              )}
              <Text dimColor>#{image.n}</Text>
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const list = await read($, images)
    // The pane shows them bigger; don't draw them twice.
    if (list.length === 0 || (await read($, paneShown))) return next(e)

    const { Box, Image, Text } = $.ui.resolve(e)
    const cells = fitRow(list.map(image => image.size), e.props.maxRows, e.props.bodyColumns, limits, e.viewport?.rows)
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          {list.map((image, i) => {
            const { columns, rows } = cells[i] ?? { columns: 4, rows: 1 }
            return (
              <Box flexDirection="column" alignItems="center" borderStyle="round" borderDimColor>
                {image.path === null ? (
                  <Box width={columns} height={rows} alignItems="center" justifyContent="center">
                    <Text dimColor wrap="truncate">no preview</Text>
                  </Box>
                ) : (
                  <Image
                    key={`image-${image.n}`}
                    source={{ file: image.path, format: 'png' }}
                    columns={columns}
                    rows={rows}
                    alt={`[Image #${image.n}]`}
                  />
                )}
                <Text dimColor>#{image.n}</Text>
              </Box>
            )
          })}
        </Box>
        {below}
      </Box>
    )
  })
}
