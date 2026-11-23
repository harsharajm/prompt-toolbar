import { expect, mock, test } from 'claude-code/testing'

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

const setup = async ($: any, on: any, engine: { agents: unknown[]; reads?: number }, opts: { isClockMocked?: boolean } = {}) => {
  const forks: string[] = []
  const open = new Set<string>()
  on('ui.focus', () => ({ value: {} }))
  on('command.register', () => ({ value: { command: 'quiz' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__quiz-pane__quiz_load' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('ui.open', (_: unknown, e: { id: string }) => {
    open.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_: unknown, e: { id: string }) => {
    open.delete(e.id)
    return { value: {} }
  })
  on('ui.panes', () => ({ value: [...open].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('agent.list', () => {
    engine.reads = (engine.reads ?? 0) + 1
    return { value: engine.agents }
  })
  if (!opts.isClockMocked) on('clock.now', () => ({ value: 61_000 }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits: [] } }))
  on('session.measure', () => ({ changed: [] }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  return { forks, open }
}

const texts = async (ui: any): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map((t: { text: string }) => t.text)

test('the agents panel shows each agent: status, model, time, tokens, cost and what it is doing', async ($, on) => {
  const engine = { agents: [agent(), agent({ id: 'a2', description: 'Ada writes poem files', status: 'completed', taskStatus: 'completed', label: 'Wrote ada-5.txt', cost: { usd: 0.02 } })] }
  await setup($, on, engine)
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })

  const ui = await $.ui.mount(pane('quiz-agents', 'Agents') as any)
  const all = (await texts(ui)).join('\n')
  expect(all).toContain('1 running · 1 finished · ~$0.03')
  expect(all).toContain('Bo writes recipe files')
  expect(all).toContain('running')
  expect(all).toContain('Haiku 5.5 · 1m 0s · 65k tokens · ~$0.01')
  expect(all).not.toContain('context')
  expect(all).toContain('Now: Writing bo-3.txt')
  expect(all).toContain('Ada writes poem files')
  expect(all).toContain('done')
  expect(all).toContain('Last: Wrote ada-5.txt')
  await ui.unmount()
  await band.unmount()
})

test('a finished agent stays listed after the engine drops it, until cleared', async ($, on) => {
  const engine = { agents: [agent({ status: 'completed', taskStatus: 'completed' })] as unknown[] }
  await setup($, on, engine)
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })

  engine.agents = []
  await band.press({ key: 'tb-agents' })
  await band.press({ key: 'tb-agents' })
  const ui = await $.ui.mount(pane('quiz-agents', 'Agents') as any)
  expect((await texts(ui)).join('\n')).toContain('Bo writes recipe files')

  await ui.press({ key: 'agents-clear' })
  engine.agents = [agent({ status: 'completed', taskStatus: 'completed' })]
  await band.press({ key: 'tb-agents' })
  await band.press({ key: 'tb-agents' })
  const all = (await texts(ui)).join('\n')
  expect(all).not.toContain('Bo writes recipe files')
  expect(all).toContain('No agents in this session yet.')
  await ui.unmount()
  await band.unmount()
})

test('an agent the engine dropped while running shows as ended', async ($, on) => {
  const engine = { agents: [agent()] as unknown[] }
  await setup($, on, engine)
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })

  engine.agents = []
  await band.press({ key: 'tb-agents' })
  await band.press({ key: 'tb-agents' })
  const ui = await $.ui.mount(pane('quiz-agents', 'Agents') as any)
  const all = (await texts(ui)).join('\n')
  expect(all).toContain('0 running · 1 finished')
  expect(all).toContain('ended')
  await ui.unmount()
  await band.unmount()
})

test('each agent has its crab: walking while it works, resting when done; the terminal draws none', async ($, on) => {
  await setup($, on, {
    agents: [agent(), agent({ id: 'a2', description: 'Opus job', model: 'claude-opus-5-5', status: 'completed', taskStatus: 'completed' })],
  })
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })

  const ui = await $.ui.mount(pane('quiz-agents', 'Agents') as any)
  const sources = (await ui.findAll({ type: 'Svg' })).map((c: { props: { source?: unknown } }) => String(c.props.source))
  expect(sources.length).toBe(2)
  // no tool call yet: thinking; done: resting
  expect(sources.some(s => s.includes('class="c-think run"'))).toBe(true)
  expect(sources.some(s => s.includes('class="c-rest"'))).toBe(true)
  expect((await texts(ui)).join('\n')).toContain('Bo writes recipe files')
  await ui.unmount()

  const term = await $.ui.mount({ ...pane('quiz-agents', 'Agents'), surface: 'terminal' } as any)
  expect((await term.findAll({ type: 'Svg' })).length).toBe(0)
  expect((await texts(term)).join('\n')).toContain('Bo writes recipe files')
  await term.unmount()
  await band.unmount()
})

test("an agent's crab and its Now line follow its latest tool call; the main chat's calls leave them alone", async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  await setup($, on, { agents: [agent()] })
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })
  const ui = await $.ui.mount(pane('quiz-agents', 'Agents') as any)
  const crab = async () => String((await ui.find({ type: 'Svg' }))?.props.source)
  const now = async () => (await texts(ui)).find(t => t.startsWith('Now: ')) ?? ''

  // a call from the main chat carries no agent id
  await $.tool.call({ tool: 'Write', file_path: 'C:/work/notes.md', content: 'x' } as any)
  expect(await crab()).toContain('class="c-think run"')

  const cases: [Record<string, unknown>, string, string][] = [
    [{ tool: 'Write', file_path: 'C:/work/agent-test-3/bo-3.txt', content: 'x' }, 'write', 'Now: Writing bo-3.txt'],
    [{ tool: 'PowerShell', command: 'Start-Sleep -Seconds 15' }, 'wait', 'Now: Waiting 15s'],
    [{ tool: 'Read', file_path: '/a/b/notes.md' }, 'read', 'Now: Reading notes.md'],
    [{ tool: 'Glob', pattern: '**/*.ts' }, 'search', 'Now: Finding **/*.ts'],
    [{ tool: 'Bash', command: 'npm test', description: 'Run the tests' }, 'run', 'Now: Running: Run the tests'],
    [{ tool: 'WebFetch', url: 'https://example.com/page', prompt: 'x' }, 'web', 'Now: Reading example.com'],
    [{ tool: 'Agent', description: 'Review the diff', prompt: 'x' }, 'delegate', 'Now: Handing off: Review the diff'],
    [{ tool: 'mcp__ccd_session__start_session', title: 'x' }, 'tool', 'Now: Using start session'],
  ]
  for (const [call, act, line] of cases) {
    await $.tool.call({ ...call, agentId: 'a1' } as any)
    expect(await crab(), String(call.tool)).toContain(`class="c-${act} run"`)
    expect(await now(), String(call.tool)).toBe(line)
  }
  await ui.unmount()
  await band.unmount()
})

test("an agent on the session's effort shows the effort its last request carried", async ($, on) => {
  await setup($, on, { agents: [agent({ lastRequest: { at: 2000, model: 'claude-haiku-5-5', effort: 'high' } })] })
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })

  const ui = await $.ui.mount(pane('quiz-agents', 'Agents') as any)
  expect((await texts(ui)).join('\n')).toContain('Haiku 5.5 · high · 1m 0s')
  await ui.unmount()
  await band.unmount()
})

test('an agent cleared from the panel that runs again is shown again', async ($, on) => {
  const engine = { agents: [agent({ status: 'completed', taskStatus: 'completed' })] as unknown[] }
  await setup($, on, engine)
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })
  const ui = await $.ui.mount(pane('quiz-agents', 'Agents') as any)
  await ui.press({ key: 'agents-clear' })
  expect((await texts(ui)).join('\n')).toContain('No agents in this session yet.')

  engine.agents = [agent({ status: 'running', taskStatus: 'running' })]
  await band.press({ key: 'tb-agents' })
  await band.press({ key: 'tb-agents' })
  const all = (await texts(ui)).join('\n')
  expect(all).toContain('1 running')
  expect(all).toContain('Bo writes recipe files')
  await ui.unmount()
  await band.unmount()
})

test('control characters in an agent text are dropped, so the panel still draws', async ($, on) => {
  await setup($, on, { agents: [agent({ description: 'Bo \u001b[31mred\u001b[0m files', label: 'Running \u0007 tests' })] })
  const band = await $.ui.mount(BAND as any)
  await band.press({ key: 'tb-agents' })

  const ui = await $.ui.mount(pane('quiz-agents', 'Agents') as any)
  const all = (await texts(ui)).join('\n')
  expect(all).toContain('Bo [31mred[0m files')
  expect(all).toContain('Now: Running tests')
  await ui.unmount()
  await band.unmount()
})

test('the agents poll runs while the panel is up and stops once the toolbar closes it', async ($, on) => {
  const clock = mock.clock(on)
  const engine = { agents: [agent()] as unknown[], reads: 0 }
  await setup($, on, engine, { isClockMocked: true })
  const band = await $.ui.mount(BAND as any)

  await band.press({ key: 'tb-agents' })
  const opened = engine.reads
  expect(opened).toBe(1)
  await clock.advance(4000)
  await clock.advance(0)
  const during = engine.reads
  expect(during).toBeGreaterThan(opened)

  await band.press({ key: 'tb-agents' })
  await clock.advance(10_000)
  await clock.advance(0)
  expect(engine.reads).toBe(during)
  await band.unmount()
})

test('a quiet agent list is not written again on each poll', async ($, on) => {
  const clock = mock.clock(on)
  const writes: unknown[] = []
  on('state.set', { plugin: 'quiz-pane', key: 'agents' }, (_: any, e: any, next: any) => {
    writes.push(e.value)
    return next(e)
  })
  await setup($, on, { agents: [agent({ status: 'completed', taskStatus: 'completed' })] }, { isClockMocked: true })
  const band = await $.ui.mount(BAND as any)

  await band.press({ key: 'tb-agents' })
  expect(writes.length).toBe(1)
  await clock.advance(10_000)
  await clock.advance(0)
  expect(writes.length).toBe(1)
  await band.unmount()
})

test('the side chat asks over the conversation and keeps its own thread', async ($, on) => {
  const prompts: string[] = []
  on('model.fork', (_: unknown, e: { prompt: string }) => {
    prompts.push(e.prompt)
    return { value: { isAnswered: true, text: `Answer ${prompts.length}.`, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  await setup($, on, { agents: [] })
  const ui = await $.ui.mount(pane('quiz-side', 'Side chat') as any)

  expect(await ui.find({ key: 'side-ask-0' })).toBeTruthy()
  await ui.input({ key: 'side-ask-0', text: 'Why did Bo take longest?', kind: 'submit' })
  expect(prompts[0]).toContain('Side question: Why did Bo take longest?')
  expect(prompts[0]).not.toContain('Earlier in this side chat')
  expect((await texts(ui)).join('\n')).toContain('You: Why did Bo take longest?')
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('Answer 1.')

  // the box starts empty again: a new key after each question
  expect(await ui.find({ key: 'side-ask-1' })).toBeTruthy()
  await ui.input({ key: 'side-ask-1', text: 'And Cy?', kind: 'submit' })
  expect(prompts[1]).toContain('Earlier in this side chat')
  expect(prompts[1]).toContain('User: Why did Bo take longest?')
  expect(prompts[1]).toContain('You: Answer 1.')
  expect(prompts[1]).toContain('Side question: And Cy?')
  await ui.unmount()
})

test('the side chat says why when no answer can come', async ($, on) => {
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }))
  await setup($, on, { agents: [] })
  const ui = await $.ui.mount(pane('quiz-side', 'Side chat') as any)

  await ui.input({ key: 'side-ask-0', text: 'Anything?', kind: 'submit' })
  expect((await texts(ui)).join('\n')).toContain('Nothing to ask about yet')
  await ui.unmount()
})

test('savvy-progress\'s band row is left out, the others stay', async ($, on) => {
  on('ui.render', { component: 'AbovePromptList', plugin: '*' }, ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {e.props.rows.map((row: { plugin: string }) => (
          <Text>{`row ${row.plugin}`}</Text>
        ))}
      </Box>
    )
  })
  const ui = await $.ui.mount({
    plugin: 'quiz-pane',
    component: 'AbovePromptList',
    requestId: 'band',
    surface: 'desktop',
    props: {
      rows: [
        { plugin: 'savvy-progress', tree: { type: 'Text', props: {}, children: ['crab'] } },
        { plugin: 'quiz-pane', tree: { type: 'Text', props: {}, children: ['toolbar'] } },
      ],
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 6,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 6 },
      view: {},
    },
  } as any)
  const all = (await texts(ui)).join('\n')
  expect(all).toContain('row quiz-pane')
  expect(all).not.toContain('row savvy-progress')
  await ui.unmount()
})
