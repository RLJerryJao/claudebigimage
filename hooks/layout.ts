export type Size = { width: number; height: number }
export type Cells = { columns: number; rows: number }
/** The largest picture box one image may take, before the band's own limits apply. */
export type Limits = { rows: number; columns: number }

export const DEFAULT_LIMITS: Limits = { rows: 20, columns: 80 }
// The Image element takes 1 to 255 cells each way.
const MAX_CELLS = 255
const MIN_COLUMNS = 4
// Past this many images the pane scrolls rather than shrinking each one further.
const MIN_PANE_ROWS = 8
// Outside fullscreen the band may be as tall as the terminal; leave the rest for the transcript.
const MAX_SCREEN_SHARE = 2 / 3
// A terminal cell is about twice as tall as it is wide.
const CELL_ASPECT = 2
// Used when the size is unknown (file over $.fs.read's 4 MiB cap, or no file).
const FALLBACK: Size = { width: 16, height: 10 }
// Each tile adds a border on every side and a label row under the picture.
const TILE_CHROME_ROWS = 3
const TILE_CHROME_COLUMNS = 2
const GAP = 1

/** The distinct image numbers a draft references, in the order they first appear. */
export function imageNumbers(draft: string): number[] {
  const seen = new Set<number>()
  for (const match of draft.matchAll(/\[Image #(\d+)\]/g)) seen.add(Number(match[1]))
  return [...seen]
}

/** Width and height from a PNG's IHDR chunk, or null when the bytes aren't a PNG. */
export function pngSize(base64: string): Size | null {
  // 24 bytes cover the signature and IHDR's width and height; 32 base64 chars decode to exactly 24.
  const head = Uint8Array.from(atob(base64.slice(0, 32)), char => char.charCodeAt(0))
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (head.length < 24 || signature.some((byte, i) => head[i] !== byte)) return null
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  return width > 0 && height > 0 ? { width, height } : null
}

/** Configured limits, clamped to what the Image element can draw. */
export function clampLimits(rows: unknown, columns: unknown): Limits {
  const clamp = (value: unknown, fallback: number, min: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_CELLS, Math.max(min, Math.round(value))) : fallback
  return { rows: clamp(rows, DEFAULT_LIMITS.rows, 1), columns: clamp(columns, DEFAULT_LIMITS.columns, MIN_COLUMNS) }
}

/** A picture box `tileRows` tall, at most `maxColumns` wide, that keeps the picture's aspect ratio. */
export function fitCells(size: Size | null, tileRows = DEFAULT_LIMITS.rows, maxColumns = DEFAULT_LIMITS.columns): Cells {
  const { width, height } = size ?? FALLBACK
  let rows = tileRows
  let columns = Math.round((rows * CELL_ASPECT * width) / height)
  if (columns > maxColumns) {
    columns = maxColumns
    rows = Math.max(1, Math.round((maxColumns * height) / (CELL_ASPECT * width)))
  }
  return { columns: Math.max(MIN_COLUMNS, columns), rows: Math.min(rows, tileRows) }
}

/**
 * Picture boxes for one row of tiles that fits the band whole, so it never scrolls:
 * the tallest tiles within `limits` whose chrome fits in `maxRows` (and in two thirds of
 * `screenRows`, when known) and whose total width fits in `bodyColumns`.
 */
export function fitRow(
  sizes: readonly (Size | null)[],
  maxRows: number,
  bodyColumns: number,
  limits: Limits = DEFAULT_LIMITS,
  screenRows?: number,
): Cells[] {
  const bandRows = screenRows === undefined ? maxRows : Math.min(maxRows, Math.floor(screenRows * MAX_SCREEN_SHARE))
  const tallest = Math.max(1, Math.min(limits.rows, bandRows - TILE_CHROME_ROWS))
  // No tile is wider than the band can hold on its own.
  const widest = Math.max(MIN_COLUMNS, Math.min(limits.columns, bodyColumns - TILE_CHROME_COLUMNS))
  for (let tileRows = tallest; tileRows > 1; tileRows--) {
    const cells = sizes.map(size => fitCells(size, tileRows, widest))
    const width = cells.reduce((sum, c) => sum + c.columns + TILE_CHROME_COLUMNS, 0) + GAP * (cells.length - 1)
    if (width <= bodyColumns) return cells
  }
  return sizes.map(size => fitCells(size, 1, widest))
}

/**
 * Picture boxes for the preview pane, stacked one per image with a label row under each:
 * as tall as `bodyRows` shares out (the pane scrolls past that), within `limits` and `bodyColumns`.
 */
export function fitColumn(
  sizes: readonly (Size | null)[],
  bodyRows: number,
  bodyColumns: number,
  limits: Limits = DEFAULT_LIMITS,
): Cells[] {
  const count = Math.max(1, sizes.length)
  const share = Math.floor((bodyRows - count) / count)
  const tall = Math.min(limits.rows, Math.max(MIN_PANE_ROWS, share))
  const widest = Math.max(MIN_COLUMNS, Math.min(limits.columns, bodyColumns))
  return sizes.map(size => fitCells(size, tall, widest))
}

/** The pane size to ask for: the rows the stacked previews want inline, the columns they want docked. */
export function paneRequest(sizes: readonly (Size | null)[], limits: Limits = DEFAULT_LIMITS): Cells {
  const cells = sizes.map(size => fitCells(size, limits.rows, limits.columns))
  return {
    rows: cells.reduce((sum, c) => sum + c.rows + 1, 0),
    columns: Math.max(MIN_COLUMNS, ...cells.map(c => c.columns)),
  }
}
