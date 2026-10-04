import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { clampLimits, fitCells, fitColumn, fitRow, imageNumbers, paneRequest, pngSize } from '../hooks/layout'

function pngHead(width: number, height: number): string {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return btoa(String.fromCharCode(...bytes))
}

test('image numbers come from the draft, deduplicated, in order', () => {
  expect(imageNumbers('look [Image #2] and [Image #1] again [Image #2]')).toEqual([2, 1])
  expect(imageNumbers('[Image 1] [image #3] #4')).toEqual([])
})

test('PNG size is read from the IHDR header', () => {
  expect(pngSize(pngHead(1630, 632))).toEqual({ width: 1630, height: 632 })
  expect(pngSize(btoa('\xff\xd8\xff\xe0 this is a jpeg, not a png...'))).toBeNull()
})

test('previews keep aspect ratio within the tile', () => {
  // Square: 20 rows tall, twice as many columns because cells are tall.
  expect(fitCells({ width: 500, height: 500 })).toEqual({ columns: 40, rows: 20 })
  // Very wide: capped at 80 columns, rows shrink to match.
  expect(fitCells({ width: 3000, height: 500 })).toEqual({ columns: 80, rows: 7 })
  // Very tall: never narrower than 4 columns.
  expect(fitCells({ width: 100, height: 2000 })).toEqual({ columns: 4, rows: 20 })
  // Smaller limits give the old thumbnail size.
  expect(fitCells({ width: 3000, height: 500 }, 6, 32)).toEqual({ columns: 32, rows: 3 })
})

test('a row of tiles shrinks to fit the band so it never scrolls', () => {
  const square = { width: 500, height: 500 }
  // Plenty of room: full 20-row tiles.
  expect(fitRow([square], 40, 200)).toEqual([{ columns: 40, rows: 20 }])
  // A short band: border and label take 3 rows, so the picture gets the rest.
  expect(fitRow([square], 7, 120)).toEqual([{ columns: 8, rows: 4 }])
  // Outside fullscreen the band is the whole terminal; keep a third of it for the transcript.
  expect(fitRow([square], 30, 200, undefined, 30)).toEqual([{ columns: 34, rows: 17 }])
  // A narrow band: three 20-row squares need 3 * 42 + 2 = 128 columns; 80 forces 12 rows.
  expect(fitRow([square, square, square], 40, 80)).toEqual([
    { columns: 24, rows: 12 },
    { columns: 24, rows: 12 },
    { columns: 24, rows: 12 },
  ])
  // One wide image is never wider than the band.
  expect(fitRow([{ width: 3000, height: 500 }], 40, 60)).toEqual([{ columns: 58, rows: 5 }])
  // Configured limits apply too.
  expect(fitRow([square], 40, 200, { rows: 6, columns: 32 })).toEqual([{ columns: 12, rows: 6 }])
})

test('the pane stacks previews and scrolls past a few', () => {
  const wide = { width: 1600, height: 900 }
  // One image takes the pane's height, less its label row, within the limits.
  expect(fitColumn([wide], 40, 100, { rows: 60, columns: 200 })).toEqual([{ columns: 100, rows: 28 }])
  // Two share it.
  expect(fitColumn([wide, wide], 40, 100, { rows: 60, columns: 200 })).toEqual([
    { columns: 68, rows: 19 },
    { columns: 68, rows: 19 },
  ])
  // Many never shrink below 8 rows; the pane scrolls instead.
  expect(fitColumn([wide, wide, wide, wide, wide, wide], 40, 100, { rows: 60, columns: 200 })[0]).toEqual({ columns: 28, rows: 8 })
  // A small configured limit still wins.
  expect(fitColumn([wide], 40, 100, { rows: 6, columns: 32 })).toEqual([{ columns: 21, rows: 6 }])
})

test('the pane asks for room for every preview', () => {
  const wide = { width: 1600, height: 900 }
  expect(paneRequest([wide, { width: 500, height: 500 }])).toEqual({ rows: 20 + 1 + 20 + 1, columns: 71 })
})

test('configured limits are clamped to what an Image can draw', () => {
  expect(clampLimits(undefined, undefined)).toEqual({ rows: 20, columns: 80 })
  expect(clampLimits(30, 120)).toEqual({ rows: 30, columns: 120 })
  expect(clampLimits(0, 1000)).toEqual({ rows: 1, columns: 255 })
  expect(clampLimits('big', Number.NaN)).toEqual({ rows: 20, columns: 80 })
})

const DIR = '/tmp/claude-501/-work/sess-1/images'

const BAND = {
  plugin: 'image-view',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const PANE = {
  plugin: 'image-view',
  component: 'Pane',
  requestId: 'image-preview',
  viewport: { columns: 200, rows: 50 },
  props: { title: 'Image preview', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 47 }, view: {} },
} as const

type On = Parameters<TestBody>[1]

/** Stands in for the engine: a draft, one cached 800x400 PNG (#1), and a pane seated or not. */
function engine(on: On, draft: { text: string }, isPlaced: boolean) {
  const calls = { opened: [] as unknown[], closed: 0 }
  let isOpen = false
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.read', () => ({ value: { text: draft.text, cursor: draft.text.length } }))
  on('env.get', () => ({ value: '/tmp/claude-501' }))
  on('session.id', () => ({ value: 'sess-1' }))
  // Another project's folder and a stray file sit beside the one holding this session.
  const entry = { size: 0, mtimeMs: 0, isLink: false }
  on('fs.list', () => ({
    value: [
      { name: '-other', kind: 'dir', ...entry },
      { name: 'notes.txt', kind: 'file', ...entry },
      { name: '-work', kind: 'dir', ...entry },
    ],
  }))
  on('fs.exists', ($, e) => ({ value: e.path === DIR || e.path === `${DIR}/1.png` }))
  on('fs.read', () => ({ value: { base64: pngHead(800, 400) } }))
  on('ui.open', ($, e) => {
    calls.opened.push(e)
    isOpen = true
    return { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }
  })
  on('ui.panes', () => ({
    value: isOpen ? [{ id: 'image-preview', title: 'Image preview', isShown: isPlaced, isFocused: false, isPlaced }] : [],
  }))
  on('ui.close', () => {
    calls.closed++
    isOpen = false
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  return calls
}

test('on a narrow terminal the band shows a pasted image without another keystroke', async ($, on) => {
  const clock = mock.clock(on)
  const draft = { text: 'see [Image #1] [Image #2]' }
  const calls = engine(on, draft, false)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(200)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const image = await ui.find({ type: 'Image' })
  // 17 rows fit the band, but beside #2's placeholder the row needs 127 columns of 120, so 16.
  expect(image?.props).toMatchObject({ source: { file: `${DIR}/1.png`, format: 'png' }, columns: 64, rows: 16 })
  // #2 has no cached file, so it gets a placeholder tile instead of a broken Image.
  expect(await ui.find({ type: 'Text', text: 'no preview' })).toBeDefined()
  await ui.unmount()
  expect(calls.opened).toHaveLength(1)

  // Sending the prompt empties the box, which clears the band and closes the waiting pane.
  draft.text = ''
  await clock.advance(200)
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Image' })).toBeUndefined()
  expect(await after.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  expect(calls.closed).toBe(1)
})

test('where the pane seats, it shows the image big and the band stays empty', async ($, on) => {
  const clock = mock.clock(on)
  const draft = { text: 'see [Image #1]' }
  const calls = engine(on, draft, true)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(200)
  expect(calls.opened[0]).toMatchObject({ id: 'image-preview', rows: 21, columns: 80 })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Image' })).toBeUndefined()
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Image' }))?.props).toMatchObject({ source: { file: `${DIR}/1.png` }, columns: 80, rows: 20 })
  await pane.unmount()

  draft.text = ''
  await clock.advance(200)
  expect(calls.closed).toBe(1)
})

test('the size limits come from the plugin options', { options: { maxHeight: 6, maxWidth: 32 } }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { text: 'see [Image #1]' }, false)

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await clock.advance(200)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Image' }))?.props).toMatchObject({ columns: 24, rows: 6 })
})
