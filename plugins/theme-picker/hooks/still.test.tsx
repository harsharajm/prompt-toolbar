import { expect, mock, test } from 'claude-code/testing'
import { sceneProblem } from './added-themes'
import { MOST_CHARACTERS, RESTING_RULE, STOP_MOTION, atRest, ownPreviewAtRest, previewAtRest, putAtRest } from './rest'
import { THEMES } from './themes'

// Backdrops are always still: every theme's scene at rest, drawn as a plain image with nothing over it. Nothing else
// moves the backdrop either: no shader, no fireworks, and no switch to turn motion back on.

const backdrop = (scene: string, plugin = 'theme-picker') =>
  ({
    plugin: 'theme-picker',
    component: 'Backdrop',
    requestId: 'backdrop',
    surface: 'desktop',
    props: { scene, plugin, glass: { blur: 14, opacity: 0.55 } },
  }) as const

const PICKER = {
  plugin: 'theme-picker',
  component: 'Pane',
  requestId: 'theme-picker',
  surface: 'desktop',
  props: { title: 'Themes', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// A preview file: the picker's tiles need some picture, not this one in particular.
const PREVIEW = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 15"><rect width="24" height="15" fill="#123"/></svg>'

// The engine beneath the plugin: a store in memory, no added themes, a stand-in preview file, and every theme drawn.
const setup = async ($: any, on: any) => {
  const commands: string[] = []
  const open = new Set<string>()
  const store = new Map<string, unknown>()
  on('store.get', (_: unknown, ev: { key: string }) => ({ value: store.get(ev.key) }))
  on('store.set', (_: unknown, ev: { key: string; value: unknown }) => {
    store.set(ev.key, ev.value)
    return { value: undefined }
  })
  on('store.delete', (_: unknown, ev: { key: string }) => {
    store.delete(ev.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  mock.env(on, {})
  on('command.register', (_: unknown, ev: { name: string }) => {
    commands.push(ev.name)
    return { value: { command: ev.name } }
  })
  on('session.id', () => ({ value: 'session-1' }))
  on('theme.set', () => ({ value: { isDrawn: true, requestId: 'r1' } }))
  on('theme.clear', () => ({ value: { isDrawn: true, requestId: 'r1' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_: unknown, ev: { id: string }) => {
    open.add(ev.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_: unknown, ev: { id: string }) => {
    open.delete(ev.id)
    return { value: {} }
  })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('fs.read', () => ({ value: PREVIEW }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('prompt.submit', (_: unknown, ev: { text: string }) => ({ text: ev.text }))
  on('session.start', (_: unknown, ev: { cwd: string }) => ({ cwd: ev.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  return { commands }
}

const run = async ($: any, args: string): Promise<string> =>
  String((await $.command.run({ command: 'custom-theme', args } as any))?.text ?? '')

// What the backdrop draws for a scene: a shader over it, if any, and its picture's props.
const drawn = async ($: any, scene: string, plugin?: string) => {
  const ui = await $.ui.mount(backdrop(scene, plugin) as any)
  const shader = await ui.find({ type: 'Shader' })
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()

  return {
    hasShader: shader !== undefined,
    source: svg === undefined ? undefined : String(svg.props.source),
    isInteractive: svg?.props.isInteractive === true,
  }
}

test('every built-in theme draws its scene at rest, as a plain image, with nothing over it', { timeoutMs: 30_000 }, async ($, on) => {
  await setup($, on)
  const builtIn = THEMES.filter(theme => theme.origin !== 'added')
  expect(builtIn.length).toBe(38)

  for (const theme of builtIn) {
    const one = await drawn($, theme.id)

    expect({ id: theme.id, hasShader: one.hasShader, isInteractive: one.isInteractive }).toEqual({ id: theme.id, hasShader: false, isInteractive: false })
    // each built-in scene carries its own resting rule, which is forced on, and the stop style comes last
    expect(one.source).toContain('@media all')
    expect(one.source).not.toMatch(/prefers-reduced-motion/i)
    // (some scenes end in a newline after </svg>)
    expect({ id: theme.id, stopsLast: one.source?.trimEnd().endsWith(`${STOP_MOTION}</svg>`) }).toEqual({ id: theme.id, stopsLast: true })
  }
})

test('a theme picked by name is drawn still too', async ($, on) => {
  await setup($, on)
  expect(await run($, 'koi-pond')).toContain('Koi Pond applied to all chats')

  const koi = await drawn($, 'koi-pond')
  expect(koi.hasShader).toBe(false)
  expect(koi.isInteractive).toBe(false)
})

test('the picker has no switch for motion and no filter for scenes that answered the pointer', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount(PICKER as any)

  expect(await ui.find({ key: 'motion' })).toBeUndefined()
  expect(await ui.find({ key: 'filter-pointer' })).toBeUndefined()
  expect(await ui.find({ key: 'filter-all' })).toBeDefined()
  expect(await ui.find({ key: 'filter-light' })).toBeDefined()
  expect(await ui.find({ key: 'filter-dark' })).toBeDefined()
  await ui.unmount()
})

test('no fireworks and no motion words: /fireworks is gone, and "still" is no command', async ($, on) => {
  const { commands } = await setup($, on)

  expect(commands).toEqual(['custom-theme', 'themes'])
  expect(await run($, 'still')).toContain('No theme named "still"')
  expect(await run($, 'moving')).toContain('No theme named "moving"')
})

test('a backdrop another plugin set is left alone', async ($, on) => {
  await setup($, on)
  expect((await drawn($, 'koi-pond', 'someone-else')).source).toBeUndefined()
})

// ---- putting a scene at rest

test("a scene at rest has its own reduced-motion rule forced on, however it's spelt", () => {
  const scene =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{animation:x 1s infinite}@media (prefers-reduced-motion: reduce){.a{animation:none}}</style><rect class="a"/></svg>'
  expect(atRest(scene)).toContain('@media all{.a{animation:none}}')
  expect(atRest(scene)).not.toContain('prefers-reduced-motion')

  const shouted = scene.replace('@media (prefers-reduced-motion: reduce)', '@MEDIA (Prefers-Reduced-Motion: Reduce)')
  expect(atRest(shouted)).toContain('@media all{.a{animation:none}}')
  expect(atRest(shouted)).not.toMatch(/prefers-reduced-motion/i)
})

test('a scene with no rule of its own has its CSS motion stopped outright', () => {
  const scene = '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{animation:x 1s infinite}</style><rect class="a"/></svg>'

  expect(atRest(scene)).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{animation:x 1s infinite}</style><rect class="a"/>' +
      '<style>:is(#_#_#_,*){animation:none!important;transition:none!important}</style></svg>',
  )
  expect(atRest('not a picture')).toBe('not a picture')
})

test('whatever a resting rule leaves moving is stopped too, !important or not', () => {
  // the rule stops .a only; .b animates, the second time !important on a more specific selector
  const partial =
    '<svg><style>.b{animation:spin 3s linear infinite}#x .b{animation:spin 3s linear infinite!important}' +
    '@media (prefers-reduced-motion: reduce){.a{animation:none}}</style></svg>'
  const still = putAtRest(partial)

  expect(still).toContain('@media all{.a{animation:none}}')
  // last, and with the weight of three ids it outranks #x .b, !important or not
  expect(still.endsWith(`${STOP_MOTION}</svg>`)).toBe(true)
})

test('an added scene that moves by SMIL, or is too long to hold still, is left out with the reason', () => {
  const plain = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.a{animation:x 1s infinite}</style><rect class="a"/></svg>'
  expect(sceneProblem(plain)).toBeUndefined()

  const smil = '<svg xmlns="http://www.w3.org/2000/svg"><rect><animate attributeName="x" from="0" to="9" dur="2s" repeatCount="indefinite"/></rect></svg>'
  expect(sceneProblem(smil)).toContain('SMIL')

  // fits the engine as it is, not once held still
  const big = `<svg xmlns="http://www.w3.org/2000/svg"><!--${'.'.repeat(MOST_CHARACTERS - 60)}--></svg>`
  expect(big.length).toBeLessThanOrEqual(MOST_CHARACTERS)
  expect(sceneProblem(big)).toContain('held still it would pass')
})

test("an added theme's previews are still too: one made from its scene, and its folder's own", () => {
  const scene = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><style>.a{animation:x 1s infinite}</style></svg>'
  const made = previewAtRest(scene)
  expect(made).toContain('width="240" height="150"')
  expect(made).not.toContain('width="1600"')
  expect(made?.endsWith(`${STOP_MOTION}</svg>`)).toBe(true)

  expect(ownPreviewAtRest('<svg><style>.a{animation:x 1s infinite}</style></svg>')?.endsWith(`${STOP_MOTION}</svg>`)).toBe(true)
  expect(ownPreviewAtRest('<svg><circle><animate attributeName="r" dur="1s" repeatCount="indefinite"/></circle></svg>')).toBeUndefined()
  expect(ownPreviewAtRest('not a picture')).toBeUndefined()
})

test('scene after scene is put at rest: the shared pattern keeps no place between them', () => {
  const a = '<svg><style>@media (prefers-reduced-motion: reduce){.a{animation:none}}</style></svg>'
  const b = '<svg><style>@media (prefers-reduced-motion: reduce){.b{animation:none}}</style></svg>'

  for (const scene of [a, b, a, b, a]) {
    expect(atRest(scene)).not.toContain('prefers-reduced-motion')
  }
  expect(RESTING_RULE.lastIndex).toBe(0)
})
