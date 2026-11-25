import { expect, mock, test } from 'claude-code/testing'
import { crabSvg } from './crabs'

// What keeps the plugin cheap while it runs, and the races those savings must not lose: the Agents
// panel's poll (slower while no agent runs, the pane checked every third tick, no reading stacked on
// one still out), each agent's Now line (no round trip for a call that changes nothing) and the
// crabs (only the newest few move). The clock is mocked throughout: ticks run as the test moves it.

const BAND = {
  plugin: 'quiz-pane',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'desktop',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const pane = (requestId: string, title: string) =>
  ({
    plugin: 'quiz-pane',
    component: 'Pane',
    requestId,
    surface: 'desktop',
    props: { title, isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const

const agent = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  description: 'Bo writes recipe files',
  type: 'general-purpose',
  status: 'running',
  kind: 'local_agent',
  taskStatus: 'running',
  label: 'Writing bo-3.txt',
  startTime: 1_000,
  cwd: '/',
  model: 'claude-haiku-5-5',
  contextWindowSize: 1_000_000,
  tokenCount: 50_000,
  tokenSamples: [],
  usage: [{ model: 'claude-haiku-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 60_000, cache_creation_input_tokens: 3500 }],
  cost: { usd: 0.0123 },
  hasRow: true,
  ...over,
})

type Engine = { agents: unknown[]; reads: number; hang: boolean; slowMs: number; panes: number; nows: number }

// the engine beneath the plugin, with counters for the calls the savings are about
const setup = async ($: any, on: any, engine: { agents: unknown[] }, now = 61_000) => {
  const e = Object.assign(engine, { reads: 0, hang: false, slowMs: 0, panes: 0, nows: 0 }) as Engine
  const open = new Set<string>()
  // the mock clock registers clock.now itself: its handler is wrapped to count the reads
  const clock = mock.clock(
    ((name: string, ...rest: any[]) => {
      if (name !== 'clock.now') return on(name, ...rest)
      const h = rest[rest.length - 1]
      return on(name, ...rest.slice(0, -1), (...a: any[]) => {
        e.nows++
        return h(...a)
      })
    }) as any,
    { now },
  )
  on('ui.focus', () => ({ value: {} }))
  on('command.register', () => ({ value: { command: 'quiz' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__quiz-pane__quiz_load' } }))
  on('tool.call', () => ({ result: {} }))
  on('session.start', (_: unknown, ev: { cwd: string }) => ({ cwd: ev.cwd }))
  on('ui.open', (_: unknown, ev: { id: string }) => {
    open.add(ev.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_: unknown, ev: { id: string }) => {
    open.delete(ev.id)
    return { value: {} }
  })
  on('ui.panes', () => {
    e.panes++
    return { value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }
  })
  on('agent.list', async () => {
    e.reads++
    if (e.hang) return new Promise(() => undefined) as any
    if (e.slowMs > 0) await clock.sleep(e.slowMs)
    return { value: e.agents }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits: [] } }))
  on('session.measure', () => ({ changed: [] }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  return { e, open, clock }
}

// n ticks of the agents poll, one at a time
const ticks = async (clock: any, n: number) => {
  for (let i = 0; i < n; i++) {
    await clock.advance(2000)
    await clock.advance(0)
  }
}

const done = () => agent({ status: 'completed', taskStatus: 'completed' })

// ---- the Agents panel's poll

test('no agent live: the agent list is read on every 2nd tick', async ($, on) => {
  const { e, clock } = await setup($, on, { agents: [done()] })
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })
  expect(e.reads).toBe(1)
  await ticks(clock, 8)
  expect(e.reads).toBe(1 + 4)
  await band.unmount()
})

test('a live agent: the agent list is read on every tick', async ($, on) => {
  const { e, clock } = await setup($, on, { agents: [agent()] })
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })
  expect(e.reads).toBe(1)
  await ticks(clock, 8)
  expect(e.reads).toBe(1 + 8)
  await band.unmount()
})

test("an agent's tool call ends the back-off at once, the main chat's call does not", async ($, on) => {
  const { e, clock } = await setup($, on, { agents: [done()] })
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })
  await ticks(clock, 2) // tick 1 skipped, tick 2 read
  expect(e.reads).toBe(2)

  // a call without an agent id leaves the back-off: tick 3 is skipped
  await $.tool.call({ tool: 'Read', file_path: '/a/main.md' } as any)
  await clock.settle()
  await ticks(clock, 1)
  expect(e.reads).toBe(2)

  // tick 4 reads, then an agent's call: tick 5 (odd) reads too
  await ticks(clock, 1)
  expect(e.reads).toBe(3)
  await $.tool.call({ tool: 'Read', file_path: '/a/b.md', agentId: 'ag-wake' } as any)
  await clock.settle()
  await ticks(clock, 1)
  expect(e.reads).toBe(4)
  await band.unmount()
})

test('the pane is checked every 3rd tick, and the poll stops once it is gone', async ($, on) => {
  const { e, open, clock } = await setup($, on, { agents: [agent()] })
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })
  e.panes = 0
  await ticks(clock, 6)
  expect(e.panes).toBe(2)
  expect(e.reads).toBe(1 + 6)

  // closed without the ui.close hook hearing it: ticks 7 and 8 still read, tick 9 finds it gone
  open.delete('quiz-agents')
  await ticks(clock, 2)
  expect(e.reads).toBe(1 + 8)
  await ticks(clock, 1)
  expect(e.panes).toBe(3)
  expect(e.reads).toBe(1 + 8)
  await ticks(clock, 10)
  expect(e.reads).toBe(1 + 8)
  expect(e.panes).toBe(3)
  await band.unmount()
})

test('a reading that never answers does not stop the poll for good: a new one starts after 5 ticks', async ($, on) => {
  const { e, clock } = await setup($, on, { agents: [agent()] })
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })
  e.hang = true
  e.reads = 0
  await ticks(clock, 5)
  expect(e.reads).toBe(1)
  await ticks(clock, 1)
  expect(e.reads).toBe(2)
  await ticks(clock, 4)
  expect(e.reads).toBe(2)
  await ticks(clock, 1)
  expect(e.reads).toBe(3)
  await band.unmount()
})

// Readings that are out across the third tick skip it; the check must still come, on the first
// tick that runs after it fell due, or a close the ui.close hook missed would leave the poll running.
for (const ticksBefore of [0, 1, 2]) {
  test(`answers 5 s late still let the poll see the pane is gone (closed after ${ticksBefore} ticks)`, async ($, on) => {
    const { e, open, clock } = await setup($, on, { agents: [agent()] }, 50_000)
    const band = await $.ui.mount(BAND as any)
    await band.press({ key: 'tb-agents' })
    for (let i = 0; i < ticksBefore; i++) await clock.advance(2000)
    await clock.settle()

    open.delete('quiz-agents')
    e.slowMs = 5000
    const before = e.reads
    for (let i = 0; i < 60; i++) await clock.advance(2000)
    await clock.advance(30_000)
    await clock.settle()
    expect(e.reads - before).toBeLessThanOrEqual(2)
    await band.unmount()
  })
}

// ---- each agent's Now line

test('noteAct: a repeated identical call reads and writes nothing', async ($, on) => {
  const writes: any[] = []
  const gets: unknown[] = []
  on('state.set', { plugin: 'quiz-pane', key: 'acts' }, (_: any, ev: any, next: any) => {
    writes.push(ev.value.value)
    return next(ev)
  })
  on('state.get', { plugin: 'quiz-pane', key: 'acts' }, (_: any, ev: any, next: any) => {
    gets.push(ev)
    return next(ev)
  })
  const { e, clock } = await setup($, on, { agents: [agent({ id: 'ag-rep' })] })
  const call = { tool: 'Read', file_path: '/a/notes.md', agentId: 'ag-rep' } as any

  await $.tool.call(call)
  await clock.settle()
  expect(writes.length).toBe(1)
  expect(writes[0]['ag-rep'].doing).toBe('Reading notes.md')

  gets.length = 0
  e.nows = 0
  for (let i = 0; i < 3; i++) {
    await $.tool.call(call)
    await clock.settle()
  }
  expect(writes.length).toBe(1)
  expect(gets.length).toBe(0)
  expect(e.nows).toBe(0)
})

test('noteAct: the one-second pacing holds and the Now line moves on after the window', async ($, on) => {
  const writes: any[] = []
  on('state.set', { plugin: 'quiz-pane', key: 'acts' }, (_: any, ev: any, next: any) => {
    writes.push(ev.value.value)
    return next(ev)
  })
  const { clock } = await setup($, on, { agents: [agent({ id: 'ag-pace' })] })
  const call = (tool: string, file: string) => $.tool.call({ tool, file_path: file, content: 'x', agentId: 'ag-pace' } as any).then(() => clock.settle())
  const last = () => writes[writes.length - 1]['ag-pace']

  await call('Read', '/a/one.md')
  expect(writes.length).toBe(1)

  // same costume, other file, inside the second: no new line
  await clock.advance(400)
  await call('Read', '/a/two.md')
  await call('Read', '/a/three.md')
  expect(writes.length).toBe(1)
  expect(last().doing).toBe('Reading one.md')

  // a new costume is shown at once
  await call('Write', '/a/four.md')
  expect(writes.length).toBe(2)
  expect(last().act).toBe('write')
  expect(last().doing).toBe('Writing four.md')

  // after the window the same costume moves the line on
  await clock.advance(1100)
  await call('Write', '/a/five.md')
  expect(writes.length).toBe(3)
  expect(last().doing).toBe('Writing five.md')
})

test('noteAct: a call inside the pacing window reads no state', async ($, on) => {
  const gets: unknown[] = []
  on('state.get', { plugin: 'quiz-pane', key: 'acts' }, (_: any, ev: any, next: any) => {
    gets.push(ev)
    return next(ev)
  })
  const { clock } = await setup($, on, { agents: [agent({ id: 'ag-win' })] })
  const call = (file: string) => $.tool.call({ tool: 'Read', file_path: file, agentId: 'ag-win' } as any).then(() => clock.settle())
  await call('/a/one.md')
  gets.length = 0
  await call('/a/two.md')
  await call('/a/three.md')
  expect(gets.length).toBe(0)
})

// The record keeps the 200 newest acts by time; an agent repeating one call keeps an old time.
// Here y1's first write is answered late, so f0's, started after it, lands first; then 199 more
// agents act, and y1's record, the oldest, is pruned. Its next call must write it back.
test("a live agent's act pruned from the record comes back on its next call", { timeoutMs: 20_000 }, async ($, on) => {
  let isLate = true
  on('state.set', { plugin: 'quiz-pane', key: 'acts' }, async (_: any, ev: any, next: any) => {
    const out = await next(ev)
    if (isLate && ev.value?.value?.y1 !== undefined) {
      isLate = false
      await clock.sleep(500)
    }
    return out
  })
  const waiter = agent({ id: 'y1', description: 'Yo waits for CI', label: '', usage: [] })
  const { clock } = await setup($, on, { agents: [waiter] }, 1_000_000)
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })
  const ui = await $.ui.mount(pane('quiz-agents', 'Agents') as any)
  const costume = async () => /class="(c-[a-z]+)/.exec(String((await ui.find({ type: 'Svg' }))?.props.source))?.[1]

  const pY = $.tool.call({ tool: 'Bash', command: 'sleep 30', agentId: 'y1' } as any)
  await clock.advance(1)
  const pF = $.tool.call({ tool: 'Read', file_path: '/f0.txt', agentId: 'f0' } as any)
  await clock.advance(1)
  await clock.advance(1000)
  await pY
  await pF
  expect(await costume()).toBe('c-wait')

  for (let i = 1; i <= 199; i++) {
    await clock.advance(10)
    await $.tool.call({ tool: 'Read', file_path: `/f${i}.txt`, agentId: `f${i}` } as any)
  }
  await clock.advance(2000)
  // pruned: the panel has no act for y1 and draws it thinking
  expect(await costume()).toBe('c-think')

  await $.tool.call({ tool: 'Bash', command: 'sleep 30', agentId: 'y1' } as any)
  await clock.advance(2000)
  expect(await costume()).toBe('c-wait')
  await ui.unmount()
  await band.unmount()
})

// ---- the crabs

test('only the 4 newest live agents have walking crabs; the others stand', async ($, on) => {
  const agents = [1, 2, 3, 4, 5, 6].map(n => agent({ id: `c${n}`, description: `Crab ${n}`, startTime: n * 1000 }))
  await setup($, on, { agents })
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })
  const ui = await $.ui.mount(pane('quiz-agents', 'Agents') as any)
  const sources = (await ui.findAll({ type: 'Svg' })).map((c: { props: { source?: unknown } }) => String(c.props.source))
  expect(sources.length).toBe(6)
  const walks = sources.map(s => s.includes('class="c-think run"'))
  // newest first: c6 c5 c4 c3 walk, c2 c1 stand
  expect(walks).toEqual([true, true, true, true, false, false])
  expect(sources[4]).toContain('class="c-think"')
  await ui.unmount()
  await band.unmount()
})

test('crabSvg gives the same drawing for the same arguments, and different ones for different', () => {
  const a = crabSvg('think', true, false)
  expect(crabSvg('think', true, false)).toBe(a)
  expect(crabSvg('think', false, false)).not.toBe(a)
  expect(crabSvg('think', false, true)).not.toBe(crabSvg('think', false, false))
  expect(crabSvg('write', true, false)).not.toBe(a)
  expect(crabSvg('write', true, false)).toBe(crabSvg('write', true, false))
})
