// Every backdrop and preview is drawn still. A scene's own rule for reduced motion, forced on, gives its resting
// picture; STOP_MOTION then stops whatever CSS motion that rule left; and a scene that moves by SMIL, which no style can
// stop, is left out where it is read (see ./added-themes).

// A scene's own rule for reduced motion. CSS reads `@media` without regard to case, and so does this.
export const RESTING_RULE = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/gi

// Put last in every scene drawn: every CSS animation and transition stopped where it stands, whatever the scene's own
// rules say. `:is(#_#_#_,*)` matches every element with the weight of three ids, so none of the scene's rules outranks
// it, !important or not. Within the backdrop's rules: a closed `<style>` holding nothing but CSS.
export const STOP_MOTION = '<style>:is(#_#_#_,*){animation:none!important;transition:none!important}</style>'

// SMIL animation, which no style stops.
export const SMIL = /<(?:animate|animateMotion|animateTransform|set)\b/i

// The engine draws an Svg source of at most this many characters (SvgProps.source).
export const MOST_CHARACTERS = 131_072

/** A scene at rest: its own reduced-motion rule forced on, then STOP_MOTION before its last `</svg>`. */
export function putAtRest(scene: string): string {
  // `replace` starts over from the top for a global pattern, so the shared RESTING_RULE keeps no place between calls.
  const forced = scene.replace(RESTING_RULE, '@media all')
  const end = forced.lastIndexOf('</svg>')

  return end === -1 ? forced : `${forced.slice(0, end)}${STOP_MOTION}${forced.slice(end)}`
}

// The backdrop's last scene put at rest, with that scene as it came: one backdrop shows at a time.
let rested: { scene: string; atRest: string } | undefined

/**
 * The backdrop's scene at rest (putAtRest). A scene runs to 115,000 characters, so it is rewritten once for each theme
 * shown, not at every draw.
 */
export function atRest(scene: string): string {
  if (rested?.scene !== scene) {
    rested = { scene, atRest: putAtRest(scene) }
  }

  return rested.atRest
}

/** A picker preview made from a whole scene: at rest, at most 240 by 150, scaled to its slot; nothing where too long. */
export function previewAtRest(scene: string): string | undefined {
  // The scene's own size fills a window; the preview's is its own, so that the Svg takes it up to the slot's width.
  const preview = putAtRest(scene).replace(
    /<svg\b([^>]*)>/,
    (_whole, attributes: string) => `<svg${attributes.replace(/\s(?:width|height)="[^"]*"/g, '')} width="240" height="150">`,
  )

  return preview.length > MOST_CHARACTERS ? undefined : preview
}

/** An added theme's own preview.svg, at rest at its own size; nothing where it moves by SMIL or would be too long. */
export function ownPreviewAtRest(preview: string): string | undefined {
  if (!/<svg[\s>]/i.test(preview) || SMIL.test(preview)) {
    return undefined
  }

  const still = putAtRest(preview)

  return still.length > MOST_CHARACTERS ? undefined : still
}
