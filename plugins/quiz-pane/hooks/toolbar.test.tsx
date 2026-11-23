import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'quiz-pane',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const setup = async ($: any, on: any, opts: { tokens?: number; commands?: string[]; usage?: { tokens: number } } = {}) => {
  // read at each call, so a test can move the context between readings
  const usage = opts.usage ?? { tokens: opts.tokens ?? 1000 }
  const runs: string[] = []
  const opened: { id: string; focus?: boolean }[] = []
  const closed: string[] = []
  const toasts: string[] = []
  const open = new Set<string>()
  // as the engine keeps them: a fresh open is shown, re-opening an open id only retitles it, and
  // closing the shown pane shows the last one opened that is left
  const view = { shown: undefined as string | undefined }
  on('command.register', () => ({ value: { command: 'quiz' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__quiz-pane__quiz_load' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('ui.open', (_: unknown, e: { id: string; focus?: boolean }) => {
    opened.push(e.focus ? { id: e.id, focus: true } : { id: e.id })
    if (!open.has(e.id)) {
      open.add(e.id)
      view.shown = e.id
    }
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_: unknown, e: { id: string }) => {
    closed.push(e.id)
    open.delete(e.id)
    if (view.shown === e.id) view.shown = [...open].at(-1)
    return { value: {} }
  })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: id === view.shown, isFocused: false, isPlaced: true })) }))
  on('command.run', (_: unknown, e: { command: string }) => {
    runs.push(e.command)
    return { text: '' }
  })
  on('command.list', () => ({ value: (opts.commands ?? ['quiz', 'themes']).map(name => ({ name, description: '', source: 'plugin' })) }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('agent.list', () => ({ value: [] }))
  on('ui.focus', () => ({ value: {} }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: usage.tokens, window: 200000, percent: Math.round((usage.tokens / 200000) * 100) }, rateLimits: [] } }))
  on('session.measure', () => ({ changed: [] }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // another plugin's pane brought to the front: the toolbar's own stay open behind it
  const cover = () => {
    view.shown = 'another-plugins-pane'
  }

  return { runs, opened, closed, toasts, open, view, cover }
}

const QUESTIONS = [{ question: 'What is 10% of 50?', options: ['5', '10'], answer: 0 }]

const ids = (opened: { id: string }[]) => opened.map(o => o.id)

test('the toolbar draws its buttons above the prompt, in plain words', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount(BAND as any)
  const labels: Record<string, string> = { 'tb-agents': 'Agents', 'tb-quiz': 'Quiz', 'tb-compact': 'Compact', 'tb-side': 'Side chat', 'tb-themes': 'Themes' }
  for (const [key, label] of Object.entries(labels)) {
    const button = await ui.find({ key })
    expect(button, key).toBeTruthy()
    expect(button?.props.label, key).toBe(label)
  }
  expect(await ui.find({ key: 'tb-pin' })).toBeFalsy()
  expect((await ui.findAll({ type: 'Button' })).length).toBe(5)
  await ui.unmount()
})

test("agents opens the toolbar's own agents panel at once, with no slash command", async ($, on) => {
  const s = await setup($, on)
  const ui = await $.ui.mount(BAND as any)

  await ui.press({ key: 'tb-agents' })
  expect(ids(s.opened)).toEqual(['quiz-agents'])
  expect(s.runs).toEqual([])
  await ui.press({ key: 'tb-agents' })
  expect(s.closed).toEqual(['quiz-agents'])
  await ui.unmount()
})

test("opening a pane closes the toolbar's other panes first", async ($, on) => {
  const s = await setup($, on)
  const ui = await $.ui.mount(BAND as any)

  await ui.press({ key: 'tb-agents' })
  await ui.press({ key: 'tb-quiz' })
  expect(s.closed).toEqual(['quiz-agents'])
  await ui.press({ key: 'tb-side' })
  expect(s.closed).toEqual(['quiz-agents', 'quiz'])
  expect([...s.open]).toEqual(['quiz-side'])
  await ui.unmount()
})

test('side chat opens its own panel and asks for the keyboard', async ($, on) => {
  const s = await setup($, on)
  const ui = await $.ui.mount(BAND as any)

  await ui.press({ key: 'tb-side' })
  expect(s.opened).toEqual([{ id: 'quiz-side', focus: true }])
  await ui.unmount()
})

test('themes leaves its picker to theme-picker, and says when that plugin is off', async ($, on) => {
  const s = await setup($, on, { commands: ['quiz'] })
  const ui = await $.ui.mount(BAND as any)

  await ui.press({ key: 'tb-themes' })
  expect(s.opened).toEqual([])
  expect(s.runs).toEqual([])
  expect(s.toasts.length).toBe(1)
  await ui.unmount()
})

test('themes leaves the picker to theme-picker and opens or closes nothing itself', async ($, on) => {
  const s = await setup($, on)
  const ui = await $.ui.mount(BAND as any)

  await ui.press({ key: 'tb-agents' })
  await ui.press({ key: 'tb-themes' })
  expect(ids(s.opened)).toEqual(['quiz-agents'])
  expect(s.closed).toEqual([])
  expect(s.toasts).toEqual([])
  await ui.unmount()
})

test("a panel open behind another pane's tab is brought to the front, not closed", async ($, on) => {
  const s = await setup($, on)
  const ui = await $.ui.mount(BAND as any)

  await ui.press({ key: 'tb-agents' })
  s.cover()
  await ui.press({ key: 'tb-agents' })
  expect([...s.open]).toEqual(['quiz-agents'])
  expect(s.view.shown).toBe('quiz-agents')

  // shown in front now, so the next press closes it
  await ui.press({ key: 'tb-agents' })
  expect([...s.open]).toEqual([])
  await ui.unmount()
})

test('a quiz the model loads, and /quiz, open alone: the toolbar closes its other panels', async ($, on) => {
  const s = await setup($, on)
  const ui = await $.ui.mount(BAND as any)

  await ui.press({ key: 'tb-side' })
  await $.tool.call({ tool: 'mcp__quiz-pane__quiz_load', title: 'Percent', questions: QUESTIONS } as any)
  expect([...s.open]).toEqual(['quiz'])

  await ui.press({ key: 'tb-agents' })
  await $.command.run({ command: 'quiz' } as any)
  expect([...s.open]).toEqual(['quiz'])
  expect(s.view.shown).toBe('quiz')
  await ui.unmount()
})

test('the compact question is not redrawn as the context moves, and Cancel brings the figure up to date in one write', async ($, on) => {
  const writes: unknown[] = []
  on('state.set', { plugin: 'quiz-pane', key: 'toolbar' }, (_: any, e: any, next: any) => {
    writes.push(e.value)
    return next(e)
  })
  const usage = { tokens: 130000 }
  await setup($, on, { usage })
  const measure = () => $.session.measure({ context: { tokens: usage.tokens, window: 200000, percent: 0 }, rateLimits: [], changed: [] } as any)
  await measure()
  expect(writes.length).toBe(1)

  const ui = await $.ui.mount(BAND as any)
  await ui.press({ key: 'tb-compact' })
  expect(writes.length).toBe(2)
  usage.tokens = 140000
  await measure()
  expect(writes.length).toBe(2)

  await ui.press({ key: 'tb-compact-no' })
  expect(writes.length).toBe(3)
  expect((await ui.find({ key: 'tb-compact' }))?.props.label).toBe('Compact 70%')
  await ui.unmount()
})

test('the toolbar is written only when what it shows changes, so it is not redrawn under the pointer', async ($, on) => {
  const writes: unknown[] = []
  on('state.set', { plugin: 'quiz-pane', key: 'toolbar' }, (_: any, e: any, next: any) => {
    writes.push(e.value)
    return next(e)
  })
  const usage = { tokens: 1000 }
  await setup($, on, { usage })
  const measure = () => $.session.measure({ context: { tokens: usage.tokens, window: 200000, percent: 0 }, rateLimits: [], changed: [] } as any)

  await measure()
  usage.tokens = 5000
  await measure()
  await measure()
  expect(writes.length).toBe(0)

  usage.tokens = 130000
  await measure()
  expect(writes.length).toBe(1)
  await measure()
  expect(writes.length).toBe(1)

  usage.tokens = 140000
  await measure()
  expect(writes.length).toBe(2)
})

test('the compact button lights up past the safe threshold', async ($, on) => {
  await setup($, on, { tokens: 130000 })
  await $.session.measure({ context: { tokens: 130000, window: 200000, percent: 65 }, rateLimits: [], changed: [] } as any)
  const ui = await $.ui.mount(BAND as any)

  expect((await ui.find({ key: 'tb-compact' }))?.props.label).toBe('Compact 65%')
  await ui.unmount()
})

test('compact asks first and compacts only on yes', async ($, on) => {
  let compacts = 0
  on('session.compact', () => {
    compacts += 1
    return { skip: 'test' }
  })
  await setup($, on)
  const ui = await $.ui.mount(BAND as any)

  await ui.press({ key: 'tb-compact' })
  expect(compacts).toBe(0)
  await ui.press({ key: 'tb-compact-no' })
  expect(compacts).toBe(0)
  expect(await ui.find({ key: 'tb-agents' })).toBeTruthy()
  await ui.press({ key: 'tb-compact' })
  await ui.press({ key: 'tb-compact-yes' })
  expect(compacts).toBe(1)
  await ui.unmount()
})
