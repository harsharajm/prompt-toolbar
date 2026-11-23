// Writes previews/<id>.svg for every built-in theme: the scene at rest, drawn small in headless Chrome and kept as a
// WebP picture inside a tiny SVG. The picker reads these files: a page of sixteen full scenes (up to 115,000 characters
// each) is more than the pane takes, while sixteen of these come to a few hundred thousand characters at most.
// Run it again after changing a scene, from anywhere: node tools/build-previews.mjs (Node 22.18 or later, and Chrome or
// Edge; CHROME names another browser's program).
import { execFileSync } from 'node:child_process'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BROWSERS = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const browser = BROWSERS.find(candidate => fs.existsSync(candidate))
// The picture's size: about twice what a pane's quarter shows, so it stays sharp on a dense screen.
const W = 256
const H = 160
const QUALITY = 0.72

if (browser === undefined) {
  throw new Error('No Chrome or Edge found: set CHROME to a Chromium browser program.')
}

// The mod's sources import their neighbours without an extension ('./scenes/classic'): try '.ts'.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../')

    return relative && !/\.[a-z]+$/i.test(path.posix.basename(specifier))
      ? nextResolve(`${specifier}.ts`, context)
      : nextResolve(specifier, context)
  },
})

const { THEMES } = await import(pathToFileURL(path.join(root, 'hooks', 'themes.ts')).href)
const RESTING_RULE = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/g
const DARK_RULE = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/g
// The glass's blur is in points of a whole window, about 1,500 across; the preview is W across.
const BLUR_SCALE = W / 1500

// Each scene at rest, drawn for the kind of window its theme is made for, with a size of its own for the canvas,
// and the glass the app lays over the chat in that theme.
const items = THEMES.map(theme => ({
  id: theme.id,
  svg: theme
    .scene()
    .replace(RESTING_RULE, '@media all')
    .replace(DARK_RULE, theme.window === 'dark' ? '@media all' : '@media not all')
    .replace(/<svg\b([^>]*)>/, (_whole, attributes) => `<svg${attributes.replace(/\s(?:width|height)="[^"]*"/g, '')} width="${W}" height="${H}">`),
  glass: {
    blur: (theme.glass.blur ?? 16) * BLUR_SCALE,
    tint: theme.glass.tint ?? (theme.window === 'dark' ? '#1f1f1f' : '#f5f5f5'),
    opacity: theme.glass.opacity ?? 0.6,
  },
}))

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-previews-'))
const page = path.join(work, 'draw.html')

fs.writeFileSync(
  page,
  `<!doctype html><meta charset="utf-8"><pre id="out">pending</pre>
<script type="application/json" id="data">${JSON.stringify(items).replace(/</g, '\\u003c')}</script>
<script>
(async () => {
  const canvas = document.createElement('canvas')
  canvas.width = ${W}
  canvas.height = ${H}
  const context = canvas.getContext('2d')
  const out = {}
  // The glass panel over the chat: a column down the middle, the scene blurred under it and veiled in the tint.
  const column = { x: Math.round(${W} * 0.24), width: Math.round(${W} * 0.52) }
  for (const { id, svg, glass } of JSON.parse(document.getElementById('data').textContent)) {
    try {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
      const picture = new Image()
      picture.src = url
      await picture.decode()
      context.clearRect(0, 0, ${W}, ${H})
      context.drawImage(picture, 0, 0, ${W}, ${H})
      context.save()
      context.beginPath()
      context.rect(column.x, 0, column.width, ${H})
      context.clip()
      if (glass.blur > 0) {
        context.filter = 'blur(' + glass.blur + 'px)'
        context.drawImage(picture, 0, 0, ${W}, ${H})
        context.filter = 'none'
      }
      context.globalAlpha = glass.opacity
      context.fillStyle = glass.tint
      context.fillRect(column.x, 0, column.width, ${H})
      context.restore()
      out[id] = canvas.toDataURL('image/webp', ${QUALITY})
      URL.revokeObjectURL(url)
    } catch (error) {
      out[id] = 'error: ' + String(error)
    }
  }
  document.getElementById('out').textContent = JSON.stringify(out)
})()
</script>`,
)

const dom = execFileSync(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    `--user-data-dir=${path.join(work, 'profile')}`,
    '--virtual-time-budget=60000',
    '--dump-dom',
    pathToFileURL(page).href,
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000, stdio: ['ignore', 'pipe', 'ignore'] },
)
const found = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)

if (found === null || found[1] === 'pending') {
  throw new Error('The browser did not finish drawing the previews.')
}

const drawn = JSON.parse(found[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
const out = path.join(root, 'previews')

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out)

let largest = 0

for (const { id } of items) {
  const href = drawn[id]

  if (typeof href !== 'string' || !href.startsWith('data:image/webp')) {
    throw new Error(`${id}: ${String(href).slice(0, 200)}`)
  }

  const preview =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="240" height="150">` +
    `<image href="${href}" xlink:href="${href}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/></svg>`

  largest = Math.max(largest, preview.length)
  fs.writeFileSync(path.join(out, `${id}.svg`), preview)
}

fs.rmSync(work, { recursive: true, force: true })
console.log(`${items.length} previews written to ${out}, the largest ${largest} characters`)
