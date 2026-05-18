# Blogger (Local-First)

A local web app for writing daily posts with inline image paste, live KaTeX preview, static-folder export, and optional SSH publish.

## Stack

- Next.js App Router (Node runtime)
- React + TypeScript
- Local filesystem APIs (`fs`) for drafts/config/export
- KaTeX (live preview + exported HTML)
- Optional image conversion to PNG via `sharp`

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Start dev server:

```bash
npm run dev
```

3. Open:

```text
http://localhost:3000
```

## Workflow

1. Fill `Post Title`, `Folder Name`, and `Root Folder`.
2. Type in the editor.
3. Paste images directly into the editor textarea:
- Image tokens (`[[img:N]]`) are inserted at cursor position.
- Preview shows images inline immediately.
4. Use `Export` to generate static post folder.
5. Optional: use `Publish` after SSH config is saved.

## Export Output

Export target folder:

```text
<rootExportDir>/<folderName>/
```

By default:

```text
~/webfinal/dailyblog/<folderName>/
```

Generated files:

- `default.html`
- `pic1.png`, `pic2.png`, ... (in post order)
- `source.json` (structured source with base64 image bytes)
- `katex/` assets (CSS/JS/fonts for offline math rendering)

### Newline and HTML behavior

- Text newlines are converted to `<br>` during export.
- Raw HTML typed in the editor is preserved and rendered.

### LaTeX support

Supported delimiters in preview and export:

- `$$ ... $$`
- `$ ... $`

## Local Storage

- Drafts: `data/drafts/*.json`
- Config: `~/.blogger/config.json`

Default `config.json` (home-expanded absolute path):

```json
{
  "rootExportDir": "/Users/<you>/webfinal/dailyblog"
}
```
`~` input is accepted in the UI and expanded when saved.

## Publish Setup (Optional)

Set publish fields in UI and click `Save Config`:

- Method: `rsync` or `scp`
- SSH User
- SSH Host
- SSH Port (default `22`)
- Remote Path

Publish behavior:

- App exports first (overwrite enabled for publish flow)
- Then runs:
  - `rsync -az --delete ...` OR
  - `scp -r ...`
- SSH runs with `BatchMode=yes` (no interactive password prompts)

## Open Existing Posts

The app scans `rootExportDir` and lists folders that contain:

- `source.json` (structured mode), or
- `default.html` only (legacy mode)

### Legacy mode

If only `default.html` exists, the app opens raw HTML editor mode.
You can edit and save `default.html` directly.

## Error Handling

Implemented checks include:

- Invalid folder names (`^[a-zA-Z0-9_-]+$`)
- Export collisions (`EXPORT_COLLISION`, with overwrite confirmation)
- Missing export before publish
- Incomplete publish config
- Invalid image conversion data
- Missing permissions or filesystem errors surfaced to UI

## Security Notes

- This app is local-first and trusts local input.
- Raw HTML is rendered as-is in preview/export.
- Publish executes local `rsync/scp` commands using configured host/path; only use trusted values.
- SSH key-based auth is expected.

## Acceptance Test Checklist

- Type multiline text in editor
- Paste 2 images between text lines
- Confirm preview shows images + rendered LaTeX
- Export a folder like `day21` under configured root
- Confirm files: `default.html`, `pic1.png`, `pic2.png`, `source.json`
- Reopen post from list and continue editing
- Configure publish and verify folder sync via rsync/scp
