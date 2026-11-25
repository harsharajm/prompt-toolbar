import type { EngineInterface } from 'claude-code'

import { MOST_CHARACTERS, SMIL, ownPreviewAtRest, putAtRest } from './rest'
import { THEMES, forgetScene } from './themes'
import type { Theme } from './themes'

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** What a scan of the added themes' folder came to: the folder read, how many themes it added, and why any was left out. */
export type AddedReport = { folder: string | undefined; added: number; skipped: string[] }

/** The folder added themes are read from: `.claude/theme-picker/themes` under the person's home folder. */
export async function addedFolder($: EngineInterface): Promise<string | undefined> {
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))

  return home === undefined || home === '' ? undefined : `${home.replace(/[\\/]+$/, '')}/.claude/theme-picker/themes`
}

/** A name as written, as an id: lower case, each run of anything else a hyphen. */
function idOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function numberIn(value: unknown, low: number, high: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback
}

/** Why the engine would not draw a scene, or not draw it still, in a few words; nothing where it would. */
export function sceneProblem(svg: string): string | undefined {
  if (!/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(svg)) {
    return 'the scene is not an <svg> document'
  }

  if (svg.length > MOST_CHARACTERS) {
    return `the scene has ${svg.length} characters, more than ${MOST_CHARACTERS}`
  }

  if (/<image\b/i.test(svg)) {
    return 'the scene holds a picture (<image>), and only vector shapes draw'
  }

  if (/<script\b|<foreignObject\b/i.test(svg)) {
    return 'the scene holds a script or a foreignObject'
  }

  // Backdrops are drawn still, and no style stops SMIL.
  if (SMIL.test(svg)) {
    return 'the scene moves by SMIL (<animate> and the like), which cannot be held still'
  }

  // Held still, a scene is a little longer (rest.ts): it must still be one the engine draws.
  if (putAtRest(svg).length > MOST_CHARACTERS) {
    return `the scene has ${svg.length} characters: held still it would pass the ${MOST_CHARACTERS} the app draws`
  }

  return undefined
}

/**
 * Reads every theme folder under the added themes' folder and puts each theme it can draw after the built-in ones,
 * taking away the ones an earlier scan put there. A folder holds `theme.json` and the scene it names (`scene.svg`
 * when it names none). A theme that cannot be read or drawn is left out, and the report says why.
 */
export async function loadAddedThemes($: EngineInterface): Promise<AddedReport> {
  for (let at = THEMES.length - 1; at >= 0; at -= 1) {
    const theme = THEMES[at]

    if (theme?.origin === 'added') {
      forgetScene(theme.id)
      THEMES.splice(at, 1)
    }
  }

  const folder = await addedFolder($)
  const report: AddedReport = { folder, added: 0, skipped: [] }

  if (folder === undefined || !(await $.fs.exists(folder))) {
    return report
  }

  const entries = [...(await $.fs.list(folder))]
    .filter(entry => entry.kind === 'dir')
    .sort((one, other) => one.name.localeCompare(other.name))

  for (const entry of entries) {
    const dir = `${folder}/${entry.name}`

    try {
      if (!(await $.fs.exists(`${dir}/theme.json`))) {
        report.skipped.push(`${entry.name}: no theme.json`)
        continue
      }

      const meta: Record<string, unknown> = JSON.parse(await $.fs.read(`${dir}/theme.json`))
      const named = meta.scene
      const sceneFile = typeof named === 'string' && !/(^|[\\/])\.\.([\\/]|$)/.test(named) ? named : 'scene.svg'
      const svg = await $.fs.read(`${dir}/${sceneFile}`)
      const problem = sceneProblem(svg)

      if (problem !== undefined) {
        report.skipped.push(`${entry.name}: ${problem}`)
        continue
      }

      const id = idOf(typeof meta.id === 'string' ? meta.id : entry.name)

      if (id === '' || THEMES.some(theme => theme.id === id)) {
        report.skipped.push(`${entry.name}: the id "${id}" is taken`)
        continue
      }

      // A small picture for the picker, where the folder has one: a full scene there would make the page heavy. Held
      // still like the backdrop; one that cannot be gives way to a preview made from the scene.
      const previewFile = `${dir}/preview.svg`
      const ownPreview = (await $.fs.exists(previewFile)) ? await $.fs.read(previewFile) : undefined
      const preview = ownPreview === undefined ? undefined : ownPreviewAtRest(ownPreview)
      const window: Theme['window'] = meta.window === 'light' ? 'light' : 'dark'
      const glass: Record<string, unknown> =
        typeof meta.glass === 'object' && meta.glass !== null ? (meta.glass as Record<string, unknown>) : {}
      const tint = glass.tint

      THEMES.push({
        id,
        title: typeof meta.title === 'string' && meta.title.trim() !== '' ? meta.title.trim() : entry.name,
        blurb: typeof meta.blurb === 'string' ? meta.blurb.trim() : '',
        window,
        glass: {
          blur: numberIn(glass.blur, 0, 64, 14),
          tint: typeof tint === 'string' && HEX.test(tint) ? tint : window === 'dark' ? '#101418' : '#f3f2ee',
          opacity: numberIn(glass.opacity, 0, 1, 0.45),
        },
        scene: () => svg,
        origin: 'added',
        ...(typeof meta.twin === 'string' && { twin: idOf(meta.twin) }),
        ...(typeof meta.source === 'string' && { source: meta.source }),
        ...(preview !== undefined && { preview }),
      })
      report.added += 1
    } catch (error) {
      report.skipped.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return report
}
