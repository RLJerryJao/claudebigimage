# Claude Big Image

A Claude Code mod that shows the images you paste as big previews above your prompt, instead of bare `[Image #1]` tags or tiny thumbnails.

A fork of [jarrodwatts/claude-image-view](https://github.com/jarrodwatts/claude-image-view) that draws larger previews (20 rows × 80 columns by default instead of 6 × 32) and makes the size configurable.

[![License](https://img.shields.io/github/license/joshhu/claudebigimage)](LICENSE)

![Claude Image View in action](claude-image-view.png)

## Install

Inside Claude Code, run:

```
/plugin marketplace add joshhu/claudebigimage
/plugin install image-view
/reload-plugins
```

That's it. Paste an image into the prompt and its preview appears above the input.

If you also have the original `image-view@claude-image-view` installed, disable it so only one of them draws.

<details>
<summary><strong>Prefer the terminal?</strong></summary>

```bash
claude plugin marketplace add joshhu/claudebigimage
claude plugin install image-view@claudebigimage
```

Then run `/reload-plugins` inside a session, or start a new one.

</details>

## What You See

Paste one or more images and a row of thumbnails sits above the prompt, each labelled with the number of its tag:

```
╭────────────────────────╮ ╭────────────╮
│                        │ │            │
│      (screenshot)      │ │  (photo)   │
│                        │ │            │
│           #1           │ │     #2     │
╰────────────────────────╯ ╰────────────╯
❯ why is the header misaligned here [Image #1] vs [Image #2]
```

- **Big previews in a pane.** On a wide terminal (144 columns or more) pasted images open in an *Image preview* pane: docked beside the transcript, floor to ceiling, in fullscreen, or above the prompt otherwise. Each image shows up to 20 rows tall and 80 columns wide by default (see [Configuration](#configuration)).
- **`/image-view` opens it anywhere.** On a narrower terminal the images show in the row above the prompt instead; run `/image-view` to open the pane at any width. Close the pane and it stays closed until you paste a different image.
- **Thumbnails appear as soon as you paste.** You don't have to type another key first.
- **Thumbnails keep their shape.** Wide screenshots stay wide and phone shots stay tall.
- **Always fits on screen.** Tiles shrink to fit the space above the prompt (and never take more than two thirds of the terminal's height), so the row never scrolls or gets cut off.
- **Clears on send.** Once the prompt is sent (or the tags are deleted), the row and the pane go away.

## Configuration

The largest size a preview may take is set by two options. Change them in the `/plugin` config menu, or in `~/.claude/settings.json` under `pluginConfigs`:

| Option | Default | Meaning |
| --- | --- | --- |
| `maxHeight` | `20` | Tallest a preview may be, in terminal rows (1–255). |
| `maxWidth` | `80` | Widest a preview may be, in terminal columns (4–255). |

Previews still shrink to fit the terminal, so a large value is safe. Set `maxHeight` to `6` and `maxWidth` to `32` for the original small thumbnails.

## How It Works

Claude Code saves every pasted image to a cache folder for the session, as `<tmp>/<project>/<session>/images/<n>.png`, and puts an `[Image #n]` tag in the prompt. Claude Big Image is a [mod](https://code.claude.com/docs/en/plugins/mods/overview):

1. Every 200ms it reads the prompt box and looks for `[Image #n]` tags. It checks on a timer because pasting an image doesn't raise an edit event.
2. For each tag it finds the cached PNG and reads its size from the PNG header.
3. It opens a pane for them, or draws them in the band above the prompt when the pane can't be seated, with Claude Code's `Image` element. The terminal reads the file itself, so the image data never passes through the mod.

## Security

Claude Big Image is local-only. It makes no network requests and writes no files. It reads the prompt box, lists Claude Code's temp folder to find the current session's image cache, and reads the first bytes of each pasted image. If `CLAUDE_CODE_TMPDIR` isn't set, it runs `id -u` once to find the default temp folder.

Run `claude plugin validate` on the repo to see every event it hooks and every call it makes.

## Requirements

- Claude Code v2.1.287 or later (mods support)
- macOS or Linux
- A terminal with the kitty graphics protocol, such as [Ghostty](https://ghostty.org) or [kitty](https://sw.kovidgoyal.net/kitty/)

Other terminals show `[Image #n]` in each tile instead of the picture. The Claude Desktop app already previews pasted images, so the mod draws nothing there.

## Troubleshooting

**The images are still small.** The terminal is too small to give them room. In fullscreen the band above the prompt gets at most half the terminal's height, so a 25-row window leaves the pictures about 2 rows. Make the window bigger, or run `/image-view` to show them in the preview pane (it opens by itself only from 144 columns, and from 110 once you've opened it with `/image-view`).

**Nothing appears when I paste.** Run `/plugin` and check the dim line under the tabs lists `image-view` as an active mod. If it isn't listed, run `/reload-plugins`.

**The tile says "no preview".** The mod couldn't find the cached file. Claude Code may have moved where it stores pasted images. Please [open an issue](https://github.com/joshhu/claudebigimage/issues) with your Claude Code version.

**The tile shows `[Image #1]` text instead of the picture.** Your terminal doesn't support the kitty graphics protocol. See [Requirements](#requirements).

**The tile shows `[Image #1]` text in agent view or a background session, even in Ghostty or kitty.** Claude Code turns terminal images off for background sessions. If you attach from a terminal with the kitty graphics protocol, turn them back on in the `env` block of `~/.claude/settings.json`, then start a new session:

```json
"env": { "CLAUDE_CODE_FORCE_TERMINAL_IMAGES": "1" }
```

## Development

```bash
git clone https://github.com/joshhu/claudebigimage
cd claudebigimage

# Load it for one session without installing
claude --plugin-dir .

# Check it and run the tests
claude plugin validate .
claude plugin test .
```

Claude Code writes the API types into `.claude-plugin/types/` the first time it loads the mod, and `tsc -p .` type-checks it from then on.

## License

MIT. See [LICENSE](LICENSE). Based on [claude-image-view](https://github.com/jarrodwatts/claude-image-view) by Jarrod Watts.
