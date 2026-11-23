import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register } from 'claude-code'

import type { AgentAct, AgentSnap, AgentsView, QuizQuestion, QuizState, Result, SideChatState, SideTurn, ToolbarState } from '../types'
import { CRAB_WORD, crabSvg } from './crabs'

// the pane's id; opened on quiz_load and by /quiz
const PANE = 'quiz'
const TOOL = 'mcp__quiz-pane__quiz_load'
const LETTERS = 'ABCDEFGH'
const ADVANCE_MS = 2500

// dark palette
const C = {
  blue: '#7aa2f7',
  green: '#9ece6a',
  red: '#f7768e',
  yellow: '#e0af68',
  purple: '#bb9af7',
  text: '#c0caf5',
  dim: '#565f89',
}

const EMPTY: QuizState = { title: '', questions: [], index: 0, history: [], results: [], isDone: false }

const blank = (): Result => ({
  wrong: [],
  isSolved: false,
  isMissed: false,
  isSkipped: false,
  isFirstTry: false,
  isGrading: false,
  isSelfCheck: false,
  routed: '',
  input: '',
  feedback: '',
})

// Change the tag when QuizState's fields change: it declines what an earlier version stored.
const quiz = atom({ plugin: 'quiz-pane', key: 'quiz' } as const, EMPTY, { shape: 'quiz-3' })

// the toolbar above the prompt: the context warning and the compact question
const toolbar = atom({ plugin: 'quiz-pane', key: 'toolbar' } as const, { isHot: false, percent: 0, isConfirming: false } as ToolbarState, {
  shape: 'toolbar-4',
})

// the toolbar's own panes beside the chat. A pane is drawn only by the plugin that opened it,
// so the toolbar opens and draws these itself; another plugin's pane id would open empty.
const AGENTS_PANE = 'quiz-agents'
const SIDE_PANE = 'quiz-side'
const TOOLBAR_PANES = [PANE, AGENTS_PANE, SIDE_PANE]

// the Agents panel's copy of the engine's agent record
const agentsView = atom({ plugin: 'quiz-pane', key: 'agents' } as const, { at: 0, list: [], hidden: [] } as AgentsView, { shape: 'agents-1' })

// what each agent is doing, from its latest tool call, by agent id
const agentActs = atom({ plugin: 'quiz-pane', key: 'acts' } as const, {} as Record<string, AgentAct>, { shape: 'acts-1' })

// the Side chat panel's questions and answers
const sideChat = atom({ plugin: 'quiz-pane', key: 'side' } as const, { turns: [], isThinking: false, round: 0 } as SideChatState, { shape: 'side-1' })

// ---- the Agents panel: the engine's own record of this session's agents ($.agent.list), read
// directly, so it opens and fills at once, mid-reply too (a slash command would wait for the turn)

const AGENTS_KEEP = 100
const AGENTS_TICK_MS = 2000
// finished agents that still show their crab, the most recent first; older rows are text alone
const CRABS_FINISHED = 10

const AGENT_WORD: Record<string, string> = {
  pending: 'starting',
  running: 'running',
  waiting: 'waiting',
  idle: 'idle',
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
  ended: 'ended',
}

const FINISHED = ['completed', 'failed', 'killed', 'ended']
const isLiveAgent = (status: string): boolean => !FINISHED.includes(status)

const agentColor = (status: string): string =>
  status === 'completed'
    ? C.green
    : status === 'failed'
      ? C.red
      : status === 'running' || status === 'pending'
        ? C.blue
        : isLiveAgent(status)
          ? C.yellow
          : C.dim

// claude-haiku-5-5 -> Haiku 5.5
const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  if (!m) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '')
  const [, family = '', major = '', minor] = m

  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

const fmtTokens = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${Math.round(n)}`)

// an estimate, as /cost's own figure is, so it reads as one
const fmtCost = (usd: number): string => `~$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)

  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

// a control character (an escape sequence, say from coloured terminal output) in any text refuses
// the whole pane, and a stored one would refuse it on every open: tab and newline alone stay
const clean = (s: string): string => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')

const tokensOf = (a: AgentInfo): number =>
  (a.usage ?? []).reduce(
    (n, u) => n + (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    0,
  )

const snapOf = (a: AgentInfo, at: number, was: AgentSnap | undefined): AgentSnap => ({
  id: a.id,
  description: clean(a.description || a.type),
  type: a.type,
  status: a.status,
  doing: clean(a.label ?? ''),
  model: a.model ?? was?.model ?? '',
  // its own effort; else, for an agent on the session's, what its last request carried
  effort: a.effort !== undefined ? String(a.effort) : a.lastRequest?.effort !== undefined ? String(a.lastRequest.effort) : (was?.effort ?? ''),
  startedAt: a.startTime,
  // first seen finished (or just finished): now; seen finished before: when it was first seen so
  endedAt: isLiveAgent(a.status) ? 0 : was !== undefined && !isLiveAgent(was.status) ? was.endedAt : at,
  tokens: Math.max(tokensOf(a), was?.tokens ?? 0),
  context: a.contextWindowSize ? Math.min(100, Math.round((a.tokenCount / a.contextWindowSize) * 100)) : 0,
  costUsd: Math.max(a.cost?.usd ?? 0, was?.costUsd ?? 0),
})

// a running agent's elapsed time is moved on at most this often while nothing else about it changes
const AGENTS_CLOCK_MS = 10_000

// the panel's copy merged with the engine's record; the same view back when there is nothing to
// write. The engine drops a finished agent's record after a while, so what was seen is kept.
const mergeAgents = (view: AgentsView, list: readonly AgentInfo[], at: number): AgentsView => {
  // an agent cleared from the panel that runs again (resumed under its id) is shown again
  const hidden = view.hidden.filter(id => !list.some(a => a.id === id && isLiveAgent(a.status)))
  const was = new Map(view.list.map(s => [s.id, s] as const))
  const seen = list.filter(a => !hidden.includes(a.id)).map(a => snapOf(a, at, was.get(a.id)))
  const ids = new Set(seen.map(s => s.id))
  const gone = view.list.filter(s => !ids.has(s.id)).map(s => (isLiveAgent(s.status) ? { ...s, status: 'ended', endedAt: at } : s))
  const all = [...seen, ...gone].sort((x, y) => y.startedAt - x.startedAt)
  const live = all.filter(s => isLiveAgent(s.status))
  const kept = [...live, ...all.filter(s => !isLiveAgent(s.status)).slice(0, AGENTS_KEEP)]
  const isSame = hidden.length === view.hidden.length && JSON.stringify(kept) === JSON.stringify(view.list)
  if (isSame && (live.length === 0 || at - view.at < AGENTS_CLOCK_MS)) return view

  return { ...view, at, list: kept, hidden }
}

// reads the engine's record into the panel's copy. `update` writes even when its change hands the
// value back, and every write redraws the panel, so the change is worked out first and written
// only when there is one. Best effort: it never throws, so the panel opens whatever happens here.
async function refreshAgents($: EngineInterface): Promise<void> {
  try {
    const list = await $.agent.list()
    const at = await $.clock.now()
    const held = await read($, agentsView)
    if (mergeAgents(held, list, at) === held) return
    await update($, agentsView, view => mergeAgents(view, list, at))
  } catch {
    // no reading this time: the panel keeps what it has
  }
}

// while the Agents panel is up the record is read every two seconds. The pane can close without this
// plugin's ui.close hook hearing it (the plugin's own close skips its own hooks; an unload runs
// none), so each tick first checks the pane is still up and stops itself when it is not. A reload
// drops the timer, and session.start starts it again.
let agentsTicker: ReturnType<EngineInterface['clock']['every']> | undefined

function watchAgents($: EngineInterface): void {
  if (agentsTicker !== undefined) return
  agentsTicker = $.clock.every(
    AGENTS_TICK_MS,
    () =>
      void (async () => {
        if (!(await $.ui.panes()).some(p => p.id === AGENTS_PANE)) return unwatchAgents()
        await refreshAgents($)
      })().catch(() => undefined),
  )
}

function unwatchAgents(): void {
  agentsTicker?.cancel()
  agentsTicker = undefined
}

// ---- the toolbar's panes, one at a time

// closes one of the toolbar's own panes; this plugin's own close skips its own ui.close hook, so the
// Agents poll is stopped here
async function closeOwnPane($: EngineInterface, id: string): Promise<void> {
  await $.ui.close({ id })
  if (id === AGENTS_PANE) unwatchAgents()
}

// shows one of the toolbar's panes in front and closes the others: from the toolbar, a quiz the model
// loads, or /quiz. A pane open behind another pane's tab is closed and opened again, since re-opening
// an open id only retitles it and a fresh open is the one shown. The Agents panel reads the engine's
// record first, so it never opens on an old or empty frame.
async function showPane($: EngineInterface, id: string, title: string, isFocused = false): Promise<void> {
  for (const pane of await $.ui.panes().catch(() => [])) {
    if (TOOLBAR_PANES.includes(pane.id)) await closeOwnPane($, pane.id)
  }
  if (id === AGENTS_PANE) await refreshAgents($)
  await $.ui.open(isFocused ? { id, title, focus: true } : { id, title })
  if (id === AGENTS_PANE) watchAgents($)
}

// a toolbar press: the pane shown in front closes; one closed, or open behind another tab, is shown
async function togglePane($: EngineInterface, id: string, title: string, isFocused = false): Promise<void> {
  const row = (await $.ui.panes().catch(() => [])).find(pane => pane.id === id)
  if (row?.isShown) await closeOwnPane($, id)
  else await showPane($, id, title, isFocused)
}

// ---- what each agent is doing: its latest tool call, for its crab's costume and the Now line

const ACTS_KEEP = 200
// a new Now line for the same costume is written at most this often, so a burst of calls (a dozen
// reads in a row) redraws the panel once, not a dozen times; a new costume is written at once
const ACT_WORDS_MS = 1000

const fileName = (p: unknown): string => (typeof p === 'string' ? (p.split(/[\\/]/).pop() ?? '') : '')

const quote = (v: unknown, max: number): string => clip(clean(String(v ?? '')).replace(/\s+/g, ' ').trim(), max)

// mcp__server__some_tool -> some tool
const toolWords = (tool: string): string => tool.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '').replace(/[_-]+/g, ' ').trim() || tool

// the action a tool call shows, and a few words on what exactly it does
const actOf = (tool: string, input: Record<string, unknown>): { act: string; doing: string } => {
  const file = fileName(input.file_path ?? input.notebook_path ?? input.path)
  switch (tool) {
    case 'Read':
    case 'NotebookRead':
      return { act: 'read', doing: file ? `Reading ${file}` : 'Reading' }
    case 'Write':
      return { act: 'write', doing: file ? `Writing ${file}` : 'Writing' }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { act: 'write', doing: file ? `Editing ${file}` : 'Editing' }
    case 'Grep':
      return { act: 'search', doing: input.pattern ? `Searching for "${quote(input.pattern, 40)}"` : 'Searching' }
    case 'Glob':
      return { act: 'search', doing: input.pattern ? `Finding ${quote(input.pattern, 40)}` : 'Finding files' }
    case 'ToolSearch':
      return { act: 'search', doing: 'Looking for a tool' }
    case 'Bash':
    case 'PowerShell': {
      const command = String(input.command ?? '')
      const sleep = /(?:Start-Sleep(?:\s+-(?:Seconds|s))?|\bsleep)\s+(\d+)/i.exec(command)
      if (sleep) return { act: 'wait', doing: `Waiting ${sleep[1]}s` }
      const what = quote(input.description, 60) || quote(command, 60)
      return { act: 'run', doing: what ? `Running: ${what}` : 'Running a command' }
    }
    case 'WebFetch': {
      const host = /^https?:\/\/([^/?#]+)/i.exec(String(input.url ?? ''))?.[1]
      return { act: 'web', doing: host ? `Reading ${host}` : 'Reading a web page' }
    }
    case 'WebSearch':
      return { act: 'web', doing: input.query ? `Searching the web for "${quote(input.query, 40)}"` : 'Searching the web' }
    case 'Agent':
    case 'Task':
      return { act: 'delegate', doing: input.description ? `Handing off: ${quote(input.description, 50)}` : 'Starting an agent' }
    case 'SendMessage':
      return { act: 'delegate', doing: 'Messaging another agent' }
    case 'Workflow':
      return { act: 'delegate', doing: 'Running a workflow' }
    case 'Monitor':
    case 'ScheduleWakeup':
      return { act: 'wait', doing: 'Waiting' }
    default:
      if (/browser|chrome/i.test(tool)) return { act: 'web', doing: 'Using the browser' }
      return { act: 'tool', doing: `Using ${quote(toolWords(tool), 40)}` }
  }
}

// when each agent's Now line was last written; module scope, so a reload only resets the pacing
const actWrittenAt = new Map<string, number>()

// records the action of one tool call in an agent's loop. Best effort: it never throws.
async function noteAct($: EngineInterface, agentId: string, tool: string, input: Record<string, unknown>): Promise<void> {
  try {
    const now = actOf(tool, input)
    const at = await $.clock.now()
    const was = (await read($, agentActs))[agentId]
    if (was !== undefined && was.act === now.act && was.doing === now.doing) return
    if (was !== undefined && was.act === now.act && at - (actWrittenAt.get(agentId) ?? 0) < ACT_WORDS_MS) return
    actWrittenAt.set(agentId, at)
    await update($, agentActs, held =>
      Object.fromEntries(
        Object.entries({ ...held, [agentId]: { ...now, at } })
          .sort((x, y) => y[1].at - x[1].at)
          .slice(0, ACTS_KEEP),
      ),
    )
  } catch {
    // the panel keeps the agent's last action
  }
}

// ---- the Side chat panel: a side question answered over the session's own conversation
// ($.model.fork). It sees everything said so far, has no tools, and adds nothing to the main chat.

const SIDE_KEEP = 40
const SIDE_CONTEXT_TURNS = 6

const sidePrompt = (turns: readonly SideTurn[], question: string): string => {
  const earlier = turns
    .filter(t => t.role !== 'note')
    .slice(-SIDE_CONTEXT_TURNS)
    .map(t => `${t.role === 'you' ? 'User' : 'You'}: ${t.text}`)
    .join('\n\n')

  return [
    'Side chat: the user asks this in a separate panel beside the conversation while the main work goes on. This exchange is not added to the main conversation.',
    'You have no tools here, so answer straight away without thinking it over: briefly and plainly, from what the conversation already holds. If the answer needs a file, a command or a search you have not seen, say so in one line instead of guessing.',
    earlier === '' ? '' : `Earlier in this side chat:\n\n${earlier}`,
    `Side question: ${question}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

const forkTrouble = (r: { reason?: string; status?: number | null }): string => {
  if (r.reason === 'nothing-to-fork') return 'Nothing to ask about yet: the main chat has no reply to build on. Send a message there first.'
  if (r.reason === 'api-error') return `The model answered with an error${r.status ? ` (${r.status})` : ''}. Try again.`
  if (r.reason === 'empty-reply') return 'The model gave an empty answer. Try rewording the question.'
  if (r.reason === 'aborted') return 'The question was cut off before an answer came.'

  return 'No answer came back.'
}

// the round of the question out with the model (-1 before its round is known), held in the module:
// a second Enter before the first write lands must not start a second fork. Clear lets go of it.
let sideAsking: number | null = null

async function askSide($: EngineInterface, value: string): Promise<void> {
  const question = clean(value).trim()
  if (question === '') return
  if (sideAsking !== null) {
    $.ui.toast('Still answering the last side question.')
    return
  }
  sideAsking = -1
  let round: number | undefined
  try {
    const was = await read($, sideChat)
    const asked: SideTurn = { role: 'you', text: question }
    const out = await update($, sideChat, s => ({ turns: [...s.turns, asked].slice(-SIDE_KEEP), isThinking: true, round: s.round + 1 }))
    round = out.round
    if (sideAsking === -1) sideAsking = round
    // the box is drawn again under a new key; keep the keys in it where the pane holds them
    void $.ui.focus({ requestId: SIDE_PANE, key: `side-ask-${round}` }).catch(() => undefined)

    let answer: SideTurn
    try {
      const r = await $.model.fork({ prompt: sidePrompt(was.turns, question) })
      answer = r.isAnswered ? { role: 'claude', text: clean(r.text).trim() || '(an empty answer)' } : { role: 'note', text: forkTrouble(r) }
    } catch (error) {
      answer = { role: 'note', text: `The question could not be sent: ${clean(String(error))}` }
    }
    // Clear moves the round on: an answer to a cleared question is dropped, and nothing is written
    // (a write of the same value would still redraw the pane)
    const mine = round
    if ((await read($, sideChat)).round === mine) {
      await update($, sideChat, s => (s.round === mine ? { ...s, turns: [...s.turns, answer].slice(-SIDE_KEEP), isThinking: false } : s))
    }
  } finally {
    if (sideAsking === (round ?? -1)) sideAsking = null
  }
}

// past this many tokens a model's answers get measurably worse ("context rot"):
// half the window, and never more than 120k, whatever the window
const safeTokens = (window: number) => Math.min(window * 0.5, 120_000)

// the context figures are read when a turn ends and when the engine measures, which a busy session
// does every second or two (each point a rate-limit window moves). `update` writes even when its
// change hands the value back, and every write redraws the toolbar, which makes a button blink under
// the pointer. So the toolbar is written only when what it shows changes: the warning turning on or
// off, and the percent while the warning is on (the only time it is shown).
async function refreshContext($: EngineInterface): Promise<void> {
  try {
    const now = await readContext($)
    if (now === undefined) return
    const shown = await read($, toolbar)
    // the compact question draws neither the warning nor the percent: nothing to redraw while it is up
    // (Cancel brings both up to date as it takes the question down)
    if (shown.isConfirming) return
    if (shown.isHot === now.isHot && (!now.isHot || shown.percent === now.percent)) return
    await update($, toolbar, t => ({ ...t, ...now }))
  } catch {
    // no reading yet
  }
}

// the context warning and its percent as they stand now; undefined before the first reading
async function readContext($: EngineInterface): Promise<{ isHot: boolean; percent: number } | undefined> {
  try {
    const { context } = await $.session.usage()
    return { isHot: (context.tokens ?? 0) >= safeTokens(context.window), percent: context.percent ?? 0 }
  } catch {
    return undefined
  }
}


// ---- what the model sent, kept only when usable

const words = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.length > 0 ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : undefined

const cleanQuestions = (raw: unknown): QuizQuestion[] => {
  if (!Array.isArray(raw)) return []

  return raw.flatMap((item: unknown): QuizQuestion[] => {
    const c = item as Record<string, unknown> | null
    if (!c || typeof c.question !== 'string') return []
    const type = c.type === 'number' || c.type === 'text' || c.type === 'reasoning' ? c.type : 'choice'

    let options: string[] = []
    let answer: number | string
    if (type === 'choice') {
      options = Array.isArray(c.options) ? c.options.filter((o): o is string => typeof o === 'string') : []
      if (options.length < 2 || typeof c.answer !== 'number' || c.answer < 0 || c.answer >= options.length) return []
      answer = c.answer
    } else if (type === 'number') {
      const n = typeof c.answer === 'string' ? Number(c.answer) : c.answer
      if (typeof n !== 'number' || Number.isNaN(n)) return []
      answer = n
    } else {
      if (typeof c.answer !== 'string' || c.answer.trim() === '') return []
      answer = c.answer
    }

    const g = c.goto as { correct?: unknown; wrong?: unknown; options?: unknown } | undefined
    const goto = g && {
      ...(typeof g.correct === 'string' && { correct: g.correct }),
      ...(typeof g.wrong === 'string' && { wrong: g.wrong }),
      ...(Array.isArray(g.options) && { options: g.options.map(o => (typeof o === 'string' ? o : null)) }),
    }

    return [
      {
        type,
        question: c.question,
        options,
        answer,
        ...(typeof c.id === 'string' && { id: c.id }),
        ...(typeof c.image === 'string' && c.image.trim() !== '' && { image: c.image.trim() }),
        ...(typeof c.imageAlt === 'string' && { imageAlt: c.imageAlt }),
        ...(typeof c.tolerance === 'number' && { tolerance: c.tolerance }),
        ...(typeof c.unit === 'string' && { unit: c.unit }),
        ...(words(c.accept) && { accept: words(c.accept) }),
        ...(words(c.keywords) && { keywords: words(c.keywords) }),
        ...(typeof c.explanation === 'string' && { explanation: c.explanation }),
        ...(goto && { goto }),
      },
    ]
  })
}

// ---- moving through the quiz

const setResult = (s: QuizState, change: (r: Result) => Result): QuizState => ({
  ...s,
  results: s.results.map((r, i) => (i === s.index ? change(r) : r)),
})

const isSettled = (r: Result) => r.isSolved || r.isMissed

const solved = (r: Result, routed: string): Result => ({
  ...r,
  isSolved: true,
  isGrading: false,
  isSelfCheck: false,
  isFirstTry: r.wrong.length === 0 && !r.isSkipped,
  routed: routed || r.routed,
})

// a pick on a choice question; a pick that leads somewhere settles the question;
// a second click on the right answer moves on
const pickOption = (s: QuizState, option: number): QuizState => {
  const q = s.questions[s.index]
  const r = s.results[s.index]
  if (!s.isDone && q && r?.isSolved && option === q.answer) return goNext(s)
  if (s.isDone || !q || !r || isSettled(r) || r.wrong.includes(String(option))) return s
  const route = q.goto?.options?.[option] ?? ''

  if (option === q.answer) return setResult(s, r => solved(r, route))

  return setResult(s, r => ({
    ...r,
    wrong: [...r.wrong, String(option)],
    ...(route !== '' && { isMissed: true, routed: route }),
  }))
}

// where to go from the current question: an index, or 'end'
const target = (s: QuizState): number | 'end' => {
  const q = s.questions[s.index]
  const r = s.results[s.index]
  const route = r.routed || (r.isSolved ? q.goto?.correct : r.wrong.length > 0 ? q.goto?.wrong : undefined)

  if (route === 'end') return 'end'
  const found = route === undefined ? -1 : s.questions.findIndex(x => x.id === route)
  if (found >= 0) return found

  return s.index + 1 >= s.questions.length ? 'end' : s.index + 1
}

// next: an untouched question counts as skipped; past the end the summary shows
const goNext = (s: QuizState): QuizState => {
  if (s.isDone || !s.results[s.index]) return s
  const marked = isSettled(s.results[s.index]) ? s : setResult(s, r => ({ ...r, isSkipped: true }))
  const to = target(marked)

  return to === 'end' ? { ...marked, isDone: true } : { ...marked, index: to, history: [...marked.history, s.index] }
}

const goPrev = (s: QuizState): QuizState => {
  if (s.isDone) return { ...s, isDone: false }
  if (s.history.length === 0) return s

  return { ...s, index: s.history[s.history.length - 1], history: s.history.slice(0, -1) }
}

// ---- checking typed answers

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}.%/ -]+/gu, ' ').replace(/\s+/g, ' ').trim()

// a number from what was typed: 12.5, 12.5%, $1,200, 3/4; null when there is none
const parseNumber = (t: string): number | null => {
  const cleaned = t.replace(/,/g, '').trim()
  const frac = /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/.exec(cleaned)
  if (frac && Number(frac[2]) !== 0) return Number(frac[1]) / Number(frac[2])
  const m = /-?\d+(?:\.\d+)?(?:e-?\d+)?/i.exec(cleaned)

  return m ? Number(m[0]) : null
}

// true or false when it can be told here; null when a model must judge
const checkLocal = (q: QuizQuestion, text: string): boolean | null => {
  const said = norm(text)
  if (q.accept) return q.accept.some(a => said.includes(norm(a)))
  if (q.keywords) return q.keywords.every(k => said.includes(norm(k)))

  return null
}

const answerLabel = (q: QuizQuestion): string =>
  q.type === 'choice' ? `${LETTERS[q.answer as number]}. ${q.options[q.answer as number]}` : `${q.answer}${q.unit ? ' ' + q.unit : ''}`

const PLACEHOLDER = {
  choice: '',
  number: 'Type a number, then Enter',
  text: 'Type your answer, then Enter',
  reasoning: 'Explain in your own words, then Enter',
}

// ---- math: LaTeX between $...$, $$...$$, \(...\) or \[...\] is shown as Unicode.
// There is no typesetter in the pane, so this is a readable approximation, not real typesetting.

const SUP: Record<string, string> = {
  ...Object.fromEntries([...'0123456789'].map((c, i) => [c, '⁰¹²³⁴⁵⁶⁷⁸⁹'[i]])),
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  n: 'ⁿ', i: 'ⁱ', T: 'ᵀ', x: 'ˣ', y: 'ʸ', z: 'ᶻ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ',
  j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ',
}
const SUB: Record<string, string> = {
  ...Object.fromEntries([...'0123456789'].map((c, i) => [c, '₀₁₂₃₄₅₆₇₈₉'[i]])),
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
}
const BB: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', E: '𝔼', P: 'ℙ' }
const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι',
  kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', leq: '≤', le: '≤',
  geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝', infty: '∞', sum: '∑',
  prod: '∏', int: '∫', partial: '∂', nabla: '∇', to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆',
  cup: '∪', cap: '∩', forall: '∀', exists: '∃', emptyset: '∅', ldots: '…', cdots: '⋯', dots: '…', mid: '|', ell: 'ℓ',
  hbar: 'ℏ', circ: '∘', odot: '⊙', otimes: '⊗', oplus: '⊕', langle: '⟨', rangle: '⟩', top: 'T', neg: '¬', land: '∧',
  lor: '∨', angle: '∠', degree: '°', prime: '′', ast: '∗', star: '⋆', quad: ' ', qquad: '  ',
}
const ACCENT: Record<string, string> = { hat: '̂', bar: '̄', overline: '̅', vec: '⃗', tilde: '̃', dot: '̇' }

const script = (body: string, map: Record<string, string>, mark: string): string => {
  const a = body.replace(/\s+/g, '')
  const mapped = [...a].map(c => map[c])
  if (mapped.every(c => c !== undefined)) return mapped.join('')

  return [...a].length === 1 ? `${mark}${a}` : `${mark}(${a})`
}

// wraps a numerator, denominator or radicand in parentheses unless it is one token
const group = (a: string): string => {
  const t = a.trim()

  return /^[\w.²³¹⁰-₟Ͱ-Ͽ]+$/.test(t) ? t : `(${t})`
}

const texMath = (src: string): string => {
  let s = src
  s = s.replace(/\\(?:text|textbf|textit|mathrm|mathbf|mathit|mathcal|mathsf|boldsymbol|operatorname|mbox)\s*\{([^{}]*)\}/g, '$1')
  s = s.replace(/\\mathbb\s*\{([A-Za-z])\}/g, (_, c: string) => BB[c] ?? c)
  s = s.replace(/\\(?:left|right|bigl|bigr|big|Big|bigg|Bigg)(?![A-Za-z])\s*/g, '')
  s = s.replace(/\\([A-Za-z]+)/g, (m, name: string) => (name in SYMBOLS ? SYMBOLS[name] : m))

  // innermost braces first; a few passes cover nesting
  for (let i = 0; i < 8; i++) {
    const before = s
    s = s.replace(/\^\s*([A-Za-z0-9+-])/g, (_, c: string) => script(c, SUP, '^'))
    s = s.replace(/_\s*([A-Za-z0-9+-])/g, (_, c: string) => script(c, SUB, '_'))
    s = s.replace(/\^\s*\{([^{}]*)\}/g, (_, a: string) => script(a, SUP, '^'))
    s = s.replace(/_\s*\{([^{}]*)\}/g, (_, a: string) => script(a, SUB, '_'))
    // a fraction followed by a letter or digit is parenthesised so 1/2x does not read as 1/(2x)
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m: string, a: string, b: string, at: number, whole: string) => {
      const f = `${group(a)}/${group(b)}`

      return /[\wͰ-Ͽ(]/.test(whole[at + m.length] ?? '') ? `(${f})` : f
    })
    s = s.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, (_, n: string, a: string) => `${script(n, SUP, '^')}√${group(a)}`)
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, a: string) => `√${group(a)}`)
    s = s.replace(/\\(hat|bar|overline|vec|tilde|dot)\s*\{([^{}]*)\}/g, (_, k: string, a: string) => `${a}${ACCENT[k]}`)
    if (s === before) break
  }

  return s
    .replace(/\\\\/g, ' ')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\([A-Za-z]+)/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\\/g, '')
}

// $5 and $10 stays text: a $...$ pair must not begin or end with a space
const tex = (text: string): string => {
  if (!text.includes('$') && !text.includes('\\(') && !text.includes('\\[')) return text

  return text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m: string) => texMath(m))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => texMath(m))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => texMath(m))
    .replace(/\$([^\s$](?:[^$]*[^\s$])?)\$/g, (_, m: string) => texMath(m))
}

// ---- pictures: an https URL or data: URI as given, a local file read and inlined

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
// the Svg element takes 131072 characters of markup; base64 text must leave room for the wrapper
const MAX_BASE64 = 120000

type Loaded = { href?: string; png?: string; note?: string }
const loaded = new Map<string, Loaded>()

const loadImage = async ($: { fs: { read: (...a: any[]) => Promise<any> } }, src: string): Promise<Loaded> => {
  const hit = loaded.get(src)
  if (hit) return hit

  let out: Loaded
  if (/^https?:\/\//i.test(src) || /^data:image\//i.test(src)) {
    out = { href: src }
  } else {
    const ext = (src.split(/[?#]/)[0].split('.').pop() ?? '').toLowerCase()
    const mime = MIME[ext]
    if (!mime) {
      out = { note: `Unsupported image type: ${src}` }
    } else {
      try {
        const { base64 } = (await $.fs.read(src, { as: 'bytes' })) as { base64: string }
        // a file the quiz shows is read as-is; nothing is written back
        out =
          base64.length > MAX_BASE64
            ? { note: `Image too large (${Math.round((base64.length * 0.75) / 1024)} KB, limit about 90 KB): ${src}` }
            : { href: `data:${mime};base64,${base64}`, ...(ext === 'png' && { png: base64 }) }
      } catch {
        out = { note: `Could not read image: ${src}` }
      }
    }
  }
  loaded.set(src, out)

  return out
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const IMG_W = 480
const IMG_H = 280
const imageSvg = (href: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${IMG_W} ${IMG_H}" width="${IMG_W}" height="${IMG_H}"><image href="${esc(href)}" xlink:href="${esc(href)}" x="0" y="0" width="${IMG_W}" height="${IMG_H}" preserveAspectRatio="xMidYMid meet"/></svg>`

// ==== typeset begin: LaTeX math laid out as SVG, textbook style, with no outside help

type TBox = { w: number; a: number; d: number; draw: (x: number, y: number) => string }
type Cls = 'ord' | 'bin' | 'rel' | 'punct' | 'open' | 'close' | 'op'
type TNode = { box: TBox; cls: Cls; build?: (sup?: TBox, sub?: TBox) => TBox }

const FONT_M = "'STIX Two Math','Cambria Math','Latin Modern Math','Times New Roman',serif"
const FONT_T = "system-ui,'Segoe UI',Roboto,'Helvetica Neue',sans-serif"
const AXIS = 0.27
let INK = '#c0caf5'

const n1 = (v: number) => String(Math.round(v * 10) / 10)
const xml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// width in em of a character, from rough serif / sans averages
const charW = (c: string): number => {
  if (/[0-9]/.test(c)) return 0.5
  if (c === ' ') return 0.25
  if (/[il.,:;'|!]/.test(c)) return 0.28
  if (/[fjtr()[\]I]/.test(c)) return 0.34
  if (c === 'm' || c === 'w') return 0.76
  if (c === 'M' || c === 'W') return 0.92
  if (/[A-Z]/.test(c)) return 0.66
  if (/[a-z]/.test(c)) return 0.47
  if (/[Α-Ωα-ωϑϕϵϱ]/.test(c)) return 0.58
  if (/[+−=×÷±∓≤≥≠≈≡∼∝∈∉⊂⊆→←↔⇒⇐⇔↦⟶⟹⟺]/.test(c)) return 0.62
  if (c === '∞') return 0.8
  return 0.6
}
const strW = (t: string, size: number) => [...t].reduce((w, c) => w + charW(c), 0) * size

const NOBOX: TBox = { w: 0, a: 0, d: 0, draw: () => '' }
const space = (w: number): TBox => ({ w, a: 0, d: 0, draw: () => '' })

const mkText = (t: string, size: number, o: { italic?: boolean; bold?: boolean } = {}): TBox => {
  const w = strW(t, size)
  const multi = [...t].length > 1
  // a lone symbol is centred in its width, so a thin bar or a wide sign sits where the spacing expects it
  const mid = !multi && !/[A-Za-z0-9]/.test(t) && t !== ' '

  return {
    w,
    a: 0.72 * size,
    d: 0.22 * size,
    draw: (x, y) =>
      `<text x="${n1(mid ? x + w / 2 : x)}" y="${n1(y)}" font-size="${n1(size)}" font-family="${FONT_M}"${o.italic ? ' font-style="italic"' : ''}${o.bold ? ' font-weight="bold"' : ''}${mid ? ' text-anchor="middle"' : ''}${multi ? ` textLength="${n1(w)}" lengthAdjust="spacing"` : ''}>${xml(t)}</text>`,
  }
}

const fix2 = (v: number) => v.toFixed(2)
const lineEl = (x1: number, y1: number, x2: number, y2: number, t: number) =>
  `<line x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}" stroke="${INK}" stroke-width="${fix2(t)}"/>`
const pathEl = (d: string, t: number) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${fix2(t)}" stroke-linejoin="miter" stroke-linecap="round"/>`

const cat = (bs: TBox[]): TBox => {
  let x = 0
  const parts: Array<[TBox, number]> = []
  for (const b of bs) {
    parts.push([b, x])
    x += b.w
  }

  return {
    w: x,
    a: Math.max(0, ...bs.map(b => b.a)),
    d: Math.max(0, ...bs.map(b => b.d)),
    draw: (px, py) => parts.map(([b, dx]) => b.draw(px + dx, py)).join(''),
  }
}

// atoms in a row, spaced by their class as TeX does
const hbox = (nodes: TNode[], size: number): TBox => {
  const cls = nodes.map(n => n.cls)
  cls.forEach((c, i) => {
    if (c !== 'bin') return
    const prev = cls[i - 1]
    if (prev === undefined || prev === 'bin' || prev === 'rel' || prev === 'open' || prev === 'punct' || prev === 'op' || i === cls.length - 1) {
      cls[i] = 'ord'
    }
  })
  const gap = (p: Cls, c: Cls) =>
    p === 'punct' ? 0.17 : p === 'bin' || c === 'bin' ? 0.22 : p === 'rel' || c === 'rel' ? 0.28 : p === 'op' || c === 'op' ? 0.12 : 0

  let x = 0
  const parts: Array<[TBox, number]> = []
  nodes.forEach((n, i) => {
    if (i > 0) x += gap(cls[i - 1], cls[i]) * size
    parts.push([n.box, x])
    x += n.box.w
  })

  return {
    w: x,
    a: Math.max(0, ...nodes.map(n => n.box.a)),
    d: Math.max(0, ...nodes.map(n => n.box.d)),
    draw: (px, py) => parts.map(([b, dx]) => b.draw(px + dx, py)).join(''),
  }
}

const withScripts = (nuc: TBox, sup: TBox | undefined, sub: TBox | undefined, size: number): TBox => {
  if (!sup && !sub) return nuc
  const up = sup ? Math.max(0.42 * size, nuc.a - 0.32 * size) : 0
  let down = sub ? Math.max(0.2 * size, nuc.d + 0.12 * size) : 0
  if (sup && sub) {
    const deficit = 0.16 * size - (up - sup.d + (down - sub.a))
    if (deficit > 0) down += deficit
  }
  const sx = nuc.w + 0.02 * size

  return {
    w: sx + Math.max(sup?.w ?? 0, sub?.w ?? 0) + 0.03 * size,
    a: Math.max(nuc.a, sup ? up + sup.a : 0),
    d: Math.max(nuc.d, sub ? down + sub.d : 0),
    draw: (x, y) => nuc.draw(x, y) + (sup ? sup.draw(x + sx, y - up) : '') + (sub ? sub.draw(x + sx, y + down) : ''),
  }
}

const fracBox = (num: TBox, den: TBox, size: number, bar = true): TBox => {
  const axis = AXIS * size
  const t = 0.06 * size
  const g = 0.14 * size
  const pad = 0.12 * size
  const w = Math.max(num.w, den.w) + 2 * pad

  return {
    w,
    a: axis + t / 2 + g + num.d + num.a,
    d: Math.max(den.a + den.d + g + t / 2 - axis, 0),
    draw: (x, y) => {
      const by = y - axis

      return (
        num.draw(x + (w - num.w) / 2, by - t / 2 - g - num.d) +
        den.draw(x + (w - den.w) / 2, by + t / 2 + g + den.a) +
        (bar ? lineEl(x + pad / 2, by, x + w - pad / 2, by, t) : '')
      )
    },
  }
}

const sqrtBox = (r: TBox, idx: TBox | undefined, size: number): TBox => {
  const top = r.a + 0.16 * size
  const bot = r.d + 0.04 * size
  const h = top + bot
  const iw = idx ? Math.max(0, idx.w - 0.25 * size) : 0
  const rw = 0.62 * size
  const w = iw + rw + r.w + 0.1 * size

  return {
    w,
    a: top + 0.06 * size,
    d: bot,
    draw: (x, y) => {
      const x0 = x + iw
      const yt = y - top
      const yb = y + bot
      const d =
        `M${n1(x0)} ${n1(yt + 0.6 * h)} L${n1(x0 + 0.14 * size)} ${n1(yt + 0.54 * h)} L${n1(x0 + 0.34 * size)} ${n1(yb)} ` +
        `L${n1(x0 + 0.6 * size)} ${n1(yt)} L${n1(x0 + rw + r.w + 0.1 * size)} ${n1(yt)}`

      return pathEl(d, 0.06 * size) + r.draw(x0 + rw, y) + (idx ? idx.draw(x, yt + 0.5 * h) : '')
    },
  }
}

const accentBox = (kind: string, b: TBox, size: number): TBox => {
  const up = b.a + 0.1 * size

  if (kind === 'underline') {
    return { ...b, d: b.d + 0.18 * size, draw: (x, y) => b.draw(x, y) + lineEl(x, y + b.d + 0.1 * size, x + b.w, y + b.d + 0.1 * size, 0.06 * size) }
  }

  return {
    w: b.w,
    a: b.a + 0.24 * size,
    d: b.d,
    draw: (x, y) => {
      const cx = x + b.w / 2
      const ty = y - up
      let mark = ''
      if (kind === 'bar' || kind === 'overline') mark = lineEl(x, ty, x + b.w, ty, 0.06 * size)
      else if (kind === 'hat' || kind === 'widehat') mark = pathEl(`M${n1(cx - 0.2 * size)} ${n1(ty)} L${n1(cx)} ${n1(ty - 0.16 * size)} L${n1(cx + 0.2 * size)} ${n1(ty)}`, 0.06 * size)
      else if (kind === 'tilde' || kind === 'widetilde')
        mark = pathEl(`M${n1(cx - 0.22 * size)} ${n1(ty)} Q${n1(cx - 0.11 * size)} ${n1(ty - 0.2 * size)} ${n1(cx)} ${n1(ty - 0.06 * size)} T${n1(cx + 0.22 * size)} ${n1(ty - 0.12 * size)}`, 0.06 * size)
      else if (kind === 'vec' || kind === 'overrightarrow') {
        const x2 = x + b.w
        mark =
          lineEl(x, ty - 0.06 * size, x2, ty - 0.06 * size, 0.055 * size) +
          pathEl(`M${n1(x2 - 0.12 * size)} ${n1(ty - 0.15 * size)} L${n1(x2)} ${n1(ty - 0.06 * size)} L${n1(x2 - 0.12 * size)} ${n1(ty + 0.03 * size)}`, 0.055 * size)
      } else if (kind === 'dot') mark = `<circle cx="${n1(cx)}" cy="${n1(ty - 0.04 * size)}" r="${fix2(0.045 * size)}" fill="${INK}"/>`
      else if (kind === 'ddot')
        mark =
          `<circle cx="${n1(cx - 0.1 * size)}" cy="${n1(ty - 0.04 * size)}" r="${fix2(0.045 * size)}" fill="${INK}"/>` +
          `<circle cx="${n1(cx + 0.1 * size)}" cy="${n1(ty - 0.04 * size)}" r="${fix2(0.045 * size)}" fill="${INK}"/>`

      return b.draw(x, y) + mark
    },
  }
}

// a delimiter as tall as what it wraps: a glyph when short, a drawn curve or rule when tall
const delimBox = (ch: string, a: number, d: number, size: number): TBox => {
  if (ch === '' || ch === '.') return NOBOX
  const axis = AXIS * size
  const half = Math.max(a - axis, d + axis, 0.5 * size)
  const top = -(axis + half) - 0.05 * size
  const bot = half - axis + 0.05 * size
  const h = bot - top
  const widths: Record<string, number> = { '(': 0.36, ')': 0.36, '[': 0.34, ']': 0.34, '{': 0.5, '}': 0.5, '|': 0.2, '‖': 0.3, '⟨': 0.4, '⟩': 0.4 }
  const w = (widths[ch] ?? 0.4) * size

  if (h < 1.3 * size) {
    const g = mkText(ch, size)

    return { w: Math.max(g.w, 0.3 * size), a: g.a, d: g.d, draw: g.draw }
  }

  return {
    w,
    a: -top,
    d: bot,
    draw: (x, y) => {
      const t = y + top
      const b = y + bot
      const m = (t + b) / 2
      const th = 0.06 * size
      const mx = (px: number, left: boolean) => (left ? x + px * w : x + w - px * w)
      const left = ch === '(' || ch === '[' || ch === '{' || ch === '⟨'
      if (ch === '(' || ch === ')')
        return pathEl(`M${n1(mx(0.8, left))} ${n1(t)} C${n1(mx(0.1, left))} ${n1(t + 0.3 * h)} ${n1(mx(0.1, left))} ${n1(t + 0.7 * h)} ${n1(mx(0.8, left))} ${n1(b)}`, th)
      if (ch === '[' || ch === ']') return pathEl(`M${n1(mx(0.8, left))} ${n1(t)} L${n1(mx(0.2, left))} ${n1(t)} L${n1(mx(0.2, left))} ${n1(b)} L${n1(mx(0.8, left))} ${n1(b)}`, th)
      if (ch === '{' || ch === '}')
        return pathEl(
          `M${n1(mx(0.85, left))} ${n1(t)} Q${n1(mx(0.5, left))} ${n1(t)} ${n1(mx(0.5, left))} ${n1(t + 0.14 * h)} L${n1(mx(0.5, left))} ${n1(m - 0.12 * h)} Q${n1(mx(0.5, left))} ${n1(m)} ${n1(mx(0.12, left))} ${n1(m)} Q${n1(mx(0.5, left))} ${n1(m)} ${n1(mx(0.5, left))} ${n1(m + 0.12 * h)} L${n1(mx(0.5, left))} ${n1(b - 0.14 * h)} Q${n1(mx(0.5, left))} ${n1(b)} ${n1(mx(0.85, left))} ${n1(b)}`,
          th,
        )
      if (ch === '⟨' || ch === '⟩') return pathEl(`M${n1(mx(0.8, left))} ${n1(t)} L${n1(mx(0.2, left))} ${n1(m)} L${n1(mx(0.8, left))} ${n1(b)}`, th)
      if (ch === '‖') return lineEl(x + 0.3 * w, t, x + 0.3 * w, b, th) + lineEl(x + 0.7 * w, t, x + 0.7 * w, b, th)

      return lineEl(x + w / 2, t, x + w / 2, b, th)
    },
  }
}

// ∑ ∏ ∫ and the like: the glyph with its limits above and below, or beside it
const bigOp = (glyph: string, g: number, gw: number, size: number, sup: TBox | undefined, sub: TBox | undefined, stacked: boolean): TBox => {
  const oy = 0.35 * g - AXIS * size
  const ga = 0.75 * g - oy
  const gd = oy + 0.2 * g
  const gap = 0.1 * size
  const mark = (x: number, y: number) => `<text x="${n1(x)}" y="${n1(y + oy)}" font-size="${n1(g)}" font-family="${FONT_M}">${xml(glyph)}</text>`

  if (stacked) {
    const w = Math.max(gw, sup?.w ?? 0, sub?.w ?? 0)

    return {
      w,
      a: ga + (sup ? gap + sup.d + sup.a : 0),
      d: gd + (sub ? gap + sub.a + sub.d : 0),
      draw: (x, y) =>
        mark(x + (w - gw) / 2, y) + (sup ? sup.draw(x + (w - sup.w) / 2, y - (ga + gap + sup.d)) : '') + (sub ? sub.draw(x + (w - sub.w) / 2, y + (gd + gap + sub.a)) : ''),
    }
  }

  const up = ga - 0.2 * size
  const down = gd - 0.05 * size

  return {
    w: gw + 0.08 * size + Math.max(sup?.w ?? 0, sub?.w ?? 0),
    a: Math.max(ga, sup ? up + sup.a : 0),
    d: Math.max(gd, sub ? down + sub.d : 0),
    draw: (x, y) => mark(x, y) + (sup ? sup.draw(x + gw + 0.12 * size, y - up) : '') + (sub ? sub.draw(x + gw - 0.04 * size, y + down) : ''),
  }
}

const GLY: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι',
  kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ',
  upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', cdot: '⋅', times: '×', div: '÷', pm: '±', mp: '∓', leq: '≤', le: '≤', geq: '≥',
  ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', infty: '∞', partial: '∂', nabla: '∇',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹',
  iff: '⟺', longrightarrow: '⟶', mapsto: '↦', in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪',
  cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', neg: '¬', lnot: '¬', land: '∧', lor: '∨', wedge: '∧',
  vee: '∨', ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱', ell: 'ℓ', hbar: 'ℏ', circ: '∘', otimes: '⊗', oplus: '⊕', odot: '⊙',
  ast: '∗', star: '⋆', bullet: '∙', angle: '∠', degree: '°', prime: '′', parallel: '∥', perp: '⊥', mid: '∣', ll: '≪', gg: '≫', aleph: 'ℵ',
  Re: 'ℜ', Im: 'ℑ', dagger: '†', top: '⊤', bot: '⊥', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', langle: '⟨', rangle: '⟩', vert: '|', Vert: '‖',
}
const BINS = new Set(['cdot', 'times', 'div', 'pm', 'mp', 'circ', 'otimes', 'oplus', 'odot', 'land', 'lor', 'wedge', 'vee', 'cup', 'cap', 'ast', 'star', 'setminus', 'bullet'])
const RELS = new Set(['leq', 'le', 'geq', 'ge', 'neq', 'ne', 'approx', 'equiv', 'sim', 'simeq', 'cong', 'propto', 'to', 'rightarrow', 'leftarrow', 'leftrightarrow', 'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'implies', 'iff', 'longrightarrow', 'mapsto', 'in', 'notin', 'ni', 'subset', 'subseteq', 'supset', 'supseteq', 'parallel', 'perp', 'll', 'gg'])
const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'det', 'gcd', 'deg', 'dim', 'ker', 'arg', 'Pr', 'hom'])
const LIMS = new Set(['lim', 'max', 'min', 'sup', 'inf', 'limsup', 'liminf'])
const BIGS: Record<string, [string, number, boolean]> = {
  sum: ['∑', 0.8, true], prod: ['∏', 0.8, true], bigcup: ['⋃', 0.8, true], bigcap: ['⋂', 0.8, true], bigoplus: ['⨁', 0.9, true],
  int: ['∫', 0.5, false], oint: ['∮', 0.55, false], iint: ['∬', 0.85, false], iiint: ['∭', 1.2, false],
}
const BLACKB: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', E: '𝔼', H: 'ℍ' }
const DELIM: Record<string, string> = { '(': '(', ')': ')', '[': '[', ']': ']', '{': '{', '}': '}', '|': '|', '‖': '‖', '\\{': '{', '\\}': '}', '\\|': '‖', '\\langle': '⟨', '\\rangle': '⟩', '<': '⟨', '>': '⟩', '.': '.', '\\vert': '|', '\\Vert': '‖' }
const ENV_DELIM: Record<string, [string, string]> = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', '.'] }

// one formula: a TeX string to a box
const typesetMath = (src: string, size: number): TBox => {
  let i = 0
  const small = (sz: number) => Math.max(sz * 0.7, size * 0.5)
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++
  }
  const readName = (): string => {
    const m = /^[A-Za-z]+/.exec(src.slice(i))
    if (m) {
      i += m[0].length

      return m[0]
    }
    const c = src[i] ?? ''
    i += 1

    return c
  }
  // the raw text inside a {group}
  const rawGroup = (): string => {
    ws()
    if (src[i] !== '{') {
      const c = src[i] ?? ''
      i += 1

      return c
    }
    let depth = 0
    const start = i + 1
    for (; i < src.length; i++) {
      if (src[i] === '\\') i++
      else if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) break
    }
    const out = src.slice(start, i)
    i += 1

    return out
  }
  const atStop = () =>
    i >= src.length || src[i] === '}' || src[i] === '&' || src.startsWith('\\\\', i) || /^\\(right|end)(?![A-Za-z])/.test(src.slice(i, i + 7))

  const seq = (sz: number): TNode[] => {
    const out: TNode[] = []
    for (;;) {
      ws()
      if (atStop()) return out
      const n = atom(sz)
      if (n) out.push(n)
    }
  }
  // the argument of a command: a {group} or a single token
  const arg = (sz: number): TBox => {
    ws()
    if (src[i] === '{') {
      i++
      const b = hbox(seq(sz), sz)
      if (src[i] === '}') i++

      return b
    }

    return atom(sz, true)?.box ?? NOBOX
  }

  const symbolNode = (name: string, sz: number): TNode => {
    const g = GLY[name] ?? name
    const cls: Cls = BINS.has(name) ? 'bin' : RELS.has(name) ? 'rel' : 'ord'

    return { box: mkText(g, sz), cls }
  }

  const command = (sz: number): TNode => {
    const name = readName()
    const node = (box: TBox, cls: Cls = 'ord'): TNode => ({ box, cls })
    const SP: Record<string, number> = { ',': 0.17, ':': 0.22, ';': 0.28, '!': -0.17, ' ': 0.28, quad: 1, qquad: 2, '\\': 0.5 }
    if (name in SP) return node(space(SP[name] * sz))
    if (['%', '$', '_', '#', '&'].includes(name)) return node(mkText(name, sz))
    if (name === '{' || name === '}') return node(mkText(name, sz))
    if (name === '|') return node(mkText('‖', sz))
    if (['displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'big', 'Big', 'bigg', 'Bigg', 'not'].includes(name)) return node(NOBOX)

    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const fs = sz * 0.88
      const num = arg(fs)
      const den = arg(fs)

      return node(fracBox(num, den, sz))
    }
    if (name === 'binom') {
      const fs = sz * 0.88
      const top = arg(fs)
      const bottom = arg(fs)
      const inner = fracBox(top, bottom, sz, false)

      return node(cat([delimBox('(', inner.a, inner.d, sz), inner, delimBox(')', inner.a, inner.d, sz)]))
    }
    if (name === 'sqrt') {
      let idx: TBox | undefined
      if (src[i] === '[') {
        const close = src.indexOf(']', i)
        if (close > 0) {
          idx = typesetMath(src.slice(i + 1, close), size * 0.5)
          i = close + 1
        }
      }

      return node(sqrtBox(arg(sz), idx, sz))
    }
    if (['text', 'textrm', 'textbf', 'textit', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'operatorname', 'mbox'].includes(name)) {
      const raw = rawGroup()

      return node(mkText(raw, sz, { bold: name === 'textbf' || name === 'mathbf', italic: name === 'textit' || name === 'mathit' }))
    }
    if (name === 'mathbb') return node(mkText(rawGroup().replace(/[A-Z]/g, c => BLACKB[c] ?? c), sz))
    if (name === 'mathcal' || name === 'mathscr') return node(mkText(rawGroup(), sz))
    if (name === 'boldsymbol' || name === 'bm') return node(arg(sz))
    if (['hat', 'widehat', 'bar', 'overline', 'underline', 'vec', 'tilde', 'widetilde', 'dot', 'ddot', 'overrightarrow'].includes(name)) return node(accentBox(name, arg(sz), sz))

    if (name === 'left') {
      ws()
      const open = src[i] === '\\' ? (i++, '\\' + readName()) : (src[i++] ?? '.')
      const inner = hbox(seq(sz), sz)
      let close = '.'
      if (/^\\right(?![A-Za-z])/.test(src.slice(i, i + 7))) {
        i += 6
        ws()
        close = src[i] === '\\' ? (i++, '\\' + readName()) : (src[i++] ?? '.')
      }

      return node(cat([delimBox(DELIM[open] ?? '.', inner.a, inner.d, sz), inner, delimBox(DELIM[close] ?? '.', inner.a, inner.d, sz)]))
    }
    if (name === 'right') {
      ws()
      if (src[i] === '\\') {
        i++
        readName()
      } else i++

      return node(NOBOX)
    }
    if (name === 'begin') return node(environment(rawGroup(), sz))
    if (name === 'end') {
      rawGroup()

      return node(NOBOX)
    }

    if (name in BIGS) {
      const [glyph, gw, stacked] = BIGS[name]
      const g = (stacked ? 1.3 : 1.75) * sz
      const n: TNode = { box: bigOp(glyph, g, gw * g, sz, undefined, undefined, stacked), cls: 'op' }
      n.build = (sup, sub) => bigOp(glyph, g, gw * g, sz, sup, sub, stacked)

      return n
    }
    if (LIMS.has(name)) {
      const word = mkText(name, sz)
      const n: TNode = { box: word, cls: 'op' }
      n.build = (sup, sub) =>
        sub || sup
          ? {
              w: Math.max(word.w, sub?.w ?? 0, sup?.w ?? 0),
              a: word.a + (sup ? 0.1 * sz + sup.d + sup.a : 0),
              d: word.d + (sub ? 0.1 * sz + sub.a + sub.d : 0),
              draw: (x: number, y: number) => {
                const w = Math.max(word.w, sub?.w ?? 0, sup?.w ?? 0)

                return word.draw(x + (w - word.w) / 2, y) + (sub ? sub.draw(x + (w - sub.w) / 2, y + word.d + 0.1 * sz + sub.a) : '') + (sup ? sup.draw(x + (w - sup.w) / 2, y - word.a - 0.1 * sz - sup.d) : '')
              },
            }
          : word

      return n
    }
    if (FUNCS.has(name)) return node(mkText(name, sz), 'op')

    return symbolNode(name, sz)
  }

  const environment = (env: string, sz: number): TBox => {
    if (env === 'array') rawGroup()
    const rows: TBox[][] = [[]]
    for (;;) {
      rows[rows.length - 1].push(hbox(seq(sz), sz))
      if (src.startsWith('\\\\', i)) {
        i += 2
        rows.push([])
      } else if (src[i] === '&') i++
      else break
    }
    if (src.startsWith('\\end', i)) {
      i += 4
      rawGroup()
    }
    if (rows.length > 1 && rows[rows.length - 1].every(c => c.w === 0)) rows.pop()

    const cols = Math.max(...rows.map(r => r.length))
    const colW = Array.from({ length: cols }, (_, j) => Math.max(0, ...rows.map(r => r[j]?.w ?? 0)))
    const rowA = rows.map(r => Math.max(0.72 * sz, ...r.map(c => c.a)))
    const rowD = rows.map(r => Math.max(0.22 * sz, ...r.map(c => c.d)))
    const cg = (env === 'cases' ? 1.2 : 1) * sz
    const rg = 0.35 * sz
    const total = rowA.reduce((s, a, k) => s + a + rowD[k], 0) + rg * (rows.length - 1)
    const left = env === 'cases' || env === 'aligned' || env === 'array'
    const gridW = colW.reduce((s, w) => s + w, 0) + cg * (cols - 1)
    const grid: TBox = {
      w: gridW,
      a: AXIS * sz + total / 2,
      d: Math.max(total / 2 - AXIS * sz, 0),
      draw: (x, y) => {
        let by = y - AXIS * sz - total / 2
        let out = ''
        rows.forEach((r, k) => {
          by += rowA[k]
          let cx = x
          r.forEach((c, j) => {
            out += c.draw(left ? cx : cx + (colW[j] - c.w) / 2, by)
            cx += colW[j] + cg
          })
          by += rowD[k] + rg
        })

        return out
      },
    }
    const [l, r] = ENV_DELIM[env] ?? ['.', '.']

    return cat([delimBox(l, grid.a, grid.d, sz), space(l === '.' ? 0 : 0.1 * sz), grid, space(r === '.' ? 0 : 0.1 * sz), delimBox(r, grid.a, grid.d, sz)])
  }

  const atom = (sz: number, bare = false): TNode | null => {
    ws()
    if (i >= src.length) return null
    const c = src[i]
    let node: TNode
    if (c === '{') {
      i++
      const b = hbox(seq(sz), sz)
      if (src[i] === '}') i++
      node = { box: b, cls: 'ord' }
    } else if (c === '\\') {
      i++
      node = command(sz)
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < src.length && (/[0-9]/.test(src[j]) || (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')))) j++
      node = { box: mkText(src.slice(i, j), sz), cls: 'ord' }
      i = j
    } else if (/[A-Za-z]/.test(c)) {
      i++
      node = { box: mkText(c, sz), cls: 'ord' }
    } else {
      i++
      const map: Record<string, [string, Cls]> = {
        '+': ['+', 'bin'], '-': ['−', 'bin'], '*': ['∗', 'bin'], '=': ['=', 'rel'], '<': ['<', 'rel'], '>': ['>', 'rel'], ',': [',', 'punct'],
        ';': [';', 'punct'], '(': ['(', 'open'], '[': ['[', 'open'], ')': [')', 'close'], ']': [']', 'close'], '~': [' ', 'ord'], '|': ['|', 'ord'],
      }
      const [g, cls] = map[c] ?? [c, 'ord']
      node = { box: g === ' ' ? space(0.28 * sz) : mkText(g, sz), cls }
    }
    if (bare) return node

    // primes and scripts
    let sup: TBox | undefined
    let sub: TBox | undefined
    const ssz = small(sz)
    for (;;) {
      ws()
      if (src[i] === "'") {
        i++
        sup = sup ? cat([sup, mkText('′', ssz)]) : mkText('′', ssz)
      } else if (src[i] === '^') {
        i++
        const b = arg(ssz)
        sup = sup ? cat([sup, b]) : b
      } else if (src[i] === '_') {
        i++
        sub = arg(ssz)
      } else if (/^\\(no)?limits(?![A-Za-z])/.test(src.slice(i, i + 9))) {
        i += src[i + 1] === 'n' ? 9 : 7
      } else break
    }

    return sup || sub ? { ...node, box: node.build ? node.build(sup, sub) : withScripts(node.box, sup, sub, sz) } : node
  }

  const all: TNode[] = []
  while (i < src.length) {
    all.push(...seq(size))
    if (i < src.length) i++
  }

  return hbox(all, size)
}

// ---- text with math in it: prose words and formulas laid out in lines that wrap

const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^\s$](?:[^$]*[^\s$])?)\$/g
const hasMath = (t: string) => /\$|\\\(|\\\[/.test(t) && new RegExp(MATH_RE.source).test(t)

type Item = { kind: 'word'; text: string; w: number } | { kind: 'math'; box: TBox } | { kind: 'break' }

const typeset = (
  text: string,
  o: { width: number; size?: number; color: string; bold?: boolean },
): { svg: string; w: number; h: number } | null => {
  try {
    INK = o.color
    const S = o.size ?? 14
    const maxW = o.width
    const wordW = (t: string) => strW(t, S) * (o.bold ? 1.08 : 1.02)
    const sp = 0.27 * S

    // chunks are unbreakable runs between spaces; display formulas stand alone
    type Chunk = { items: Item[]; display: boolean }
    const chunks: Chunk[] = []
    let cur: Item[] = []
    let sawSpace = false
    const flush = () => {
      if (cur.length) chunks.push({ items: cur, display: false })
      cur = []
    }
    const pushText = (s: string) => {
      for (const tok of s.match(/\s+|\S+/g) ?? []) {
        if (/^\s+$/.test(tok)) {
          if (tok.includes('\n')) {
            flush()
            chunks.push({ items: [{ kind: 'break' }], display: false })
          } else flush()
          sawSpace = true
        } else {
          cur.push({ kind: 'word', text: tok, w: wordW(tok) })
          sawSpace = false
        }
      }
    }

    let last = 0
    for (const m of text.matchAll(MATH_RE)) {
      pushText(text.slice(last, m.index))
      last = (m.index ?? 0) + m[0].length
      const display = m[1] !== undefined || m[2] !== undefined
      const body = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim()
      const box = typesetMath(body, display ? S * 1.15 : S)
      if (display) {
        flush()
        chunks.push({ items: [{ kind: 'math', box }], display: true })
      } else cur.push({ kind: 'math', box })
    }
    pushText(text.slice(last))
    flush()
    void sawSpace

    // wrap
    type Line = { chunks: Chunk[]; w: number; display: boolean }
    const lines: Line[] = []
    let line: Line = { chunks: [], w: 0, display: false }
    const chunkW = (c: Chunk) => c.items.reduce((s, it) => s + (it.kind === 'word' ? it.w : it.kind === 'math' ? it.box.w : 0), 0)
    for (const c of chunks) {
      if (c.items[0]?.kind === 'break') {
        lines.push(line)
        line = { chunks: [], w: 0, display: false }
        continue
      }
      if (c.display) {
        if (line.chunks.length) lines.push(line)
        lines.push({ chunks: [c], w: chunkW(c), display: true })
        line = { chunks: [], w: 0, display: false }
        continue
      }
      const w = chunkW(c)
      if (line.chunks.length && line.w + sp + w > maxW) {
        lines.push(line)
        line = { chunks: [], w: 0, display: false }
      }
      line.w += (line.chunks.length ? sp : 0) + w
      line.chunks.push(c)
    }
    if (line.chunks.length) lines.push(line)

    const natural = Math.max(maxW, ...lines.map(l => l.w))
    let y = 2
    let out = ''
    for (const l of lines) {
      let a = 0.78 * S
      let d = 0.26 * S
      for (const c of l.chunks) for (const it of c.items) if (it.kind === 'math') {
        a = Math.max(a, it.box.a)
        d = Math.max(d, it.box.d)
      }
      const base = y + a
      let x = l.display ? (natural - l.w) / 2 : 0
      let run: { text: string; x: number; w: number } | null = null
      const endRun = () => {
        if (run) {
          out += `<text x="${n1(run.x)}" y="${n1(base)}" font-size="${n1(S)}" font-family="${FONT_T}"${o.bold ? ' font-weight="bold"' : ''} textLength="${n1(run.w)}" lengthAdjust="spacing" xml:space="preserve">${xml(run.text)}</text>`
          run = null
        }
      }
      l.chunks.forEach((c, k) => {
        if (k > 0) x += sp
        for (const it of c.items) {
          if (it.kind === 'word') {
            if (run && Math.abs(run.x + run.w - x) < 0.01 + sp) {
              const gap = x - (run.x + run.w) > 0.5
              run.text += (gap ? ' ' : '') + it.text
              run.w = x + it.w - run.x
            } else {
              endRun()
              run = { text: it.text, x, w: it.w }
            }
            x += it.w
          } else if (it.kind === 'math') {
            endRun()
            out += it.box.draw(x, base)
            x += it.box.w
          }
        }
      })
      endRun()
      y += a + d + 0.28 * S
    }
    const h = Math.max(y, S * 1.4)
    const w = Math.ceil(natural)

    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${Math.ceil(h)}" width="${w}" height="${Math.ceil(h)}"><g fill="${o.color}" stroke="none">${out}</g></svg>`,
      w: Math.min(w, maxW),
      h: Math.ceil(h * Math.min(1, maxW / w)),
    }
  } catch {
    return null
  }
}

// ==== typeset end

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'quiz', description: 'Open the quiz pane on the right' })
    await $.tool.register({
      name: 'quiz_load',
      isDeferred: false,
      description:
        'Load a quiz into the quiz pane shown beside the chat. The person answers in the pane (click an option, or type); a correct answer moves on by itself. Call this when asked to quiz the person; do not ask the questions in chat as well. Replaces any quiz in progress. Math: write every formula, equation, fraction, exponent, root, sum, integral or matrix as LaTeX between $...$ (inline) or $$...$$ (own line) in questions, options, explanations and reference answers, with backslashes escaped for JSON (e.g. "$\\\\frac{a}{b}$"); the pane typesets it as a real equation (stacked fractions, radicals, big operators with limits, matrices, cases, accents). Plain dollar amounts like $5 are left alone. Pictures: give a question an "image" (https URL, data:image URI, or a local file path to a png/jpg/gif/webp/svg under about 90 KB) and an "imageAlt". Question types: "choice" (default; options + answer index), "number" (answer is a number, optional tolerance and unit), "text" (short sentence; answer is the reference, plus accept phrases or keywords to check it, else a model grades it), "reasoning" (the person explains in their own words; answer is the reference reasoning/key points, a model grades it). Branching: give questions an id and a goto ({ correct, wrong, options: [id|null per option] }) so the next question depends on the answer; "end" finishes. Without goto the quiz runs in list order.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short quiz title, e.g. "Percentages".' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Name for goto targets; only needed on questions others lead to.' },
                type: { type: 'string', enum: ['choice', 'number', 'text', 'reasoning'] },
                question: { type: 'string', description: 'May contain LaTeX in $...$.' },
                image: { type: 'string', description: 'Picture under the question: https URL, data:image URI, or local file path (png, jpg, gif, webp, svg; under about 90 KB).' },
                imageAlt: { type: 'string', description: 'What the picture shows, for a reader that cannot see it.' },
                options: { type: 'array', items: { type: 'string' }, description: 'choice only: 2 to 6 options, no letter prefixes.' },
                answer: {
                  description:
                    'choice: 0-based index of the correct option. number: the numeric answer. text and reasoning: the reference answer or key points.',
                },
                tolerance: { type: 'number', description: 'number only: how far off still counts (default 0.01).' },
                unit: { type: 'string', description: 'number only: shown with the answer, e.g. "%".' },
                accept: { type: 'array', items: { type: 'string' }, description: 'text only: any of these phrases in the reply is right.' },
                keywords: { type: 'array', items: { type: 'string' }, description: 'text only: every one of these must appear in the reply.' },
                explanation: { type: 'string', description: 'One or two sentences shown after the question is answered.' },
                goto: {
                  type: 'object',
                  properties: {
                    correct: { type: 'string', description: 'id of the next question when answered right, or "end".' },
                    wrong: { type: 'string', description: 'id of the next question when moved on after wrong tries, or "end".' },
                    options: {
                      type: 'array',
                      items: { type: ['string', 'null'] },
                      description: 'choice only: per option, the id the pick leads to (settles the question at once), or null.',
                    },
                  },
                },
              },
              required: ['question', 'answer'],
            },
          },
        },
        required: ['questions'],
      },
    })

    // a reload keeps the panes up but drops timers and any answer in flight
    try {
      if ((await $.ui.panes()).some(p => p.id === AGENTS_PANE)) {
        await refreshAgents($)
        watchAgents($)
      }
    } catch {
      // no surface yet: the panes open later
    }
    try {
      if ((await read($, sideChat)).isThinking) await update($, sideChat, s => ({ ...s, isThinking: false }))
    } catch {
      // nothing stored yet
    }

    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { title?: unknown; questions?: unknown }
    const questions = cleanQuestions(input.questions)

    if (questions.length === 0) {
      return { deny: 'quiz_load: no valid questions. Check each type: choice needs options (2+) and an answer index; number a numeric answer; text and reasoning a reference answer string.' }
    }

    const title = typeof input.title === 'string' ? input.title : 'Quiz'
    await update($, quiz, () => ({ ...EMPTY, title, questions, results: questions.map(blank) }))
    await showPane($, PANE, 'Quiz')

    return { result: `Quiz "${title}" loaded in the quiz pane on the right: ${questions.length} questions. The person answers there; do not repeat the questions in chat.` }
  }).catch(() => ({ deny: 'quiz_load failed. Tell the person the quiz pane could not load.' }))

  on('command.run', { command: 'quiz' }, async $ => {
    await showPane($, PANE, 'Quiz')

    return { text: 'Quiz pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Input } = ui
    // the terminal draws pictures with Image; every other surface with Svg
    const isTerminal = e.surface === 'terminal'
    const Svg = isTerminal ? undefined : (ui as Extract<typeof ui, { Svg: unknown }>).Svg
    const Pic = isTerminal ? (ui as Extract<typeof ui, { Image: unknown }>).Image : undefined
    const s = await read($, quiz)
    // the pane's width in pixels, for laying equations out
    // a fixed layout width: the surface scales the drawing to the pane, so a resize never changes the tree
    const paneW = 340

    // text with equations drawn as real typeset math where vector drawing exists, plain text elsewhere
    const rich = (text: string, color: string, bold = false, width = paneW) => {
      const out = Svg && hasMath(text) ? typeset(text, { width, size: 14, color, bold }) : null

      return out ? (
        <Svg source={out.svg} alt={tex(text)} />
      ) : (
        <Text color={color} bold={bold}>
          {tex(text)}
        </Text>
      )
    }

    if (s.questions.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
          <Text color={C.blue} bold>
            Quiz
          </Text>
          <Text color={C.dim}>No quiz loaded yet. Ask Claude: "quiz me on percentages, 10 questions".</Text>
        </Box>
      )
    }

    const total = s.questions.length
    const score = s.results.filter(r => r.isFirstTry).length
    const isBranching = s.questions.some(x => x.goto !== undefined)

    if (s.isDone) {
      const seen = Math.max(1, s.results.filter(r => r.isSolved || r.isSkipped || r.isMissed || r.wrong.length > 0).length)
      const pct = Math.round((score / seen) * 100)
      const color = pct >= 80 ? C.green : pct >= 50 ? C.yellow : C.red
      const verdict = pct >= 80 ? 'Great work!' : pct >= 50 ? 'Getting there.' : 'Keep practising.'

      return (
        <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
          <Text color={C.blue} bold>
            {s.title}
          </Text>
          <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={2} paddingY={1}>
            <Text color={color} bold>
              {verdict}
            </Text>
            <Text color={C.text} bold>
              {score} / {seen} right on the first try ({pct}%)
            </Text>
          </Box>
          <Box gap={2}>
            <Button key="back" plain label="◀ Review" onPress={() => void update($, quiz, goPrev)} />
            <Button key="again" variant="primary" label="Restart" onPress={() => void update($, quiz, p => ({ ...p, index: 0, history: [], results: p.questions.map(blank), isDone: false }))} />
            <Button key="close" dimColor label="Close pane" onPress={() => void $.ui.close({ id: PANE })} />
          </Box>
        </Box>
      )
    }

    const q = s.questions[s.index]
    const r = s.results[s.index]
    const index = s.index
    const isTyped = q.type !== 'choice'
    const img = q.image !== undefined ? await loadImage($, q.image) : undefined

    // after a right answer, move on by itself once the feedback has been read
    const afterRight = (p: QuizState) => {
      if (p.results[index]?.isSolved && !r.isSolved) {
        $.clock.after(ADVANCE_MS, () => {
          void update($, quiz, n => (n.index === index && n.results[index]?.isSolved && !n.isDone ? goNext(n) : n))
        })
      }
    }

    const choose = async (option: number) => afterRight(await update($, quiz, p => pickOption(p, option)))

    // one try at a typed question
    const submit = async (raw: string) => {
      const text = raw.trim()
      if (text === '' || isSettled(r) || r.isGrading) return

      const apply = async (next: (p: QuizState) => QuizState) => afterRight(await update($, quiz, p => (p.index === index ? next(p) : p)))

      if (q.type === 'number') {
        const got = parseNumber(text)
        if (got === null) return void apply(p => setResult(p, x => ({ ...x, feedback: 'That is not a number. Try again.' })))
        const ok = Math.abs(got - (q.answer as number)) <= (q.tolerance ?? 0.01)

        return void apply(p => (ok ? setResult(p, x => ({ ...solved(x, ''), input: text, feedback: '' })) : setResult(p, x => ({ ...x, wrong: [...x.wrong, text], feedback: '' }))))
      }

      const local = checkLocal(q, text)
      if (local !== null) {
        return void apply(p => (local ? setResult(p, x => ({ ...solved(x, ''), input: text, feedback: '' })) : setResult(p, x => ({ ...x, wrong: [...x.wrong, text], feedback: '' }))))
      }

      // a model judges the reply against the reference
      await update($, quiz, p => (p.index === index ? setResult(p, x => ({ ...x, isGrading: true, feedback: '' })) : p))
      let verdict: { ok: boolean; feedback: string } | null = null
      try {
        const res = await $.model.complete({
          model: 'haiku',
          effort: 'low',
          maxTokens: 200,
          timeoutMs: 25000,
          system:
            'You grade a student answer. Reply with PASS or FAIL on the first line, then one short sentence of feedback to the student on the second. Judge the substance against the reference, not the wording: a correct idea in different words passes.',
          prompt: `Question: ${q.question}\nReference answer / key points: ${q.answer}\nStudent answer: ${text}`,
        })
        if (res.isAnswered) {
          const [first, ...rest] = res.text.trim().split('\n')
          if (/^\s*(pass|fail)/i.test(first)) verdict = { ok: /^\s*pass/i.test(first), feedback: rest.join(' ').trim() }
        }
      } catch {
        // falls back to the person's own check below
      }

      if (verdict === null) {
        return void apply(p => setResult(p, x => ({ ...x, isGrading: false, isSelfCheck: true, input: text })))
      }
      const v = verdict

      return void apply(p => (v.ok ? setResult(p, x => ({ ...solved(x, ''), input: text, feedback: v.feedback })) : setResult(p, x => ({ ...x, wrong: [...x.wrong, text], feedback: v.feedback, isGrading: false }))))
    }

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
        <Text color={C.blue} bold>
          {s.title}
        </Text>

        <Box gap={2} alignItems="center">
          <Box gap={1}>
            <Button key="prev" plain dimColor={s.history.length === 0} label="◀" onPress={() => void update($, quiz, goPrev)} />
            <Button key="next" plain label="▶" onPress={() => void update($, quiz, goNext)} />
          </Box>
          <Text color={C.dim}>
            Question {s.history.length + 1}
            {isBranching ? '' : ` of ${total}`}
          </Text>
        </Box>

        {rich(`${s.history.length + 1}. ${q.question}`, C.text, true)}

        {img !== undefined &&
          (img.href !== undefined && Svg ? (
            <Svg source={imageSvg(img.href)} alt={q.imageAlt ?? 'question image'} width={IMG_W} height={IMG_H} />
          ) : img.png !== undefined && Pic ? (
            <Pic source={{ png: img.png }} columns={40} rows={14} alt={q.imageAlt ?? 'question image'} />
          ) : (
            <Text color={C.dim}>🖼 {img.note ?? q.imageAlt ?? q.image}</Text>
          ))}

        {q.type === 'choice' ? (
          <Box flexDirection="column" alignItems="stretch" gap={1}>
            {q.options.map((opt, i) => {
              const isWrong = r.wrong.includes(String(i))
              const isRight = r.isSolved && i === q.answer

              return (
                <Button key={`q${index}-o${i}`} label={`${LETTERS[i]}. ${tex(opt)}`} onPress={() => void choose(i)}>
                  <Text backgroundColor={isWrong ? C.red : isRight ? C.green : C.blue} color="#1a1b26" bold>
                    {isWrong ? ' ✗ ' : isRight ? ' ✓ ' : ` ${i + 1} `}
                  </Text>
                  <Text color={isWrong ? C.dim : C.text} dimColor={isWrong}>
                    {' '}
                    {tex(opt)}
                  </Text>
                </Button>
              )
            })}
          </Box>
        ) : r.isSolved ? (
          <Text color={C.dim}>Your answer: {r.input}</Text>
        ) : (
          <Input key={`ans-${index}`} placeholder={PLACEHOLDER[q.type]} rows={q.type === 'reasoning' ? 4 : 1} onSubmit={v => void submit(v)} />
        )}

        {r.isGrading && <Text color={C.dim}>Checking your answer…</Text>}

        {r.isSolved && (
          <Box flexDirection="column">
            <Text color={C.green} bold>
              ✅ Correct
            </Text>
            {r.feedback !== '' && rich(r.feedback, C.text)}
            {q.explanation !== undefined && rich(q.explanation, C.text)}
          </Box>
        )}

        {r.isMissed && (
          <Box flexDirection="column">
            {rich(`✗ Not quite. Answer: ${answerLabel(q)}`, C.red)}
            {q.explanation !== undefined && rich(q.explanation, C.text)}
          </Box>
        )}

        {r.isSelfCheck && !isSettled(r) && (
          <Box flexDirection="column" gap={1}>
            <Text color={C.yellow}>Could not grade this one. Compare with the reference:</Text>
            {rich(String(q.answer), C.text)}
            <Box gap={2}>
              <Button key="got" variant="primary" label="✅ I got it" onPress={() => void update($, quiz, p => (p.index === index ? setResult(p, x => ({ ...solved(x, ''), input: x.input })) : p))} />
              <Button key="missed" label="✗ I missed it" onPress={() => void update($, quiz, p => (p.index === index ? setResult(p, x => ({ ...x, isSelfCheck: false, wrong: [...x.wrong, x.input] })) : p))} />
            </Box>
          </Box>
        )}

        {!isSettled(r) && r.wrong.length === 0 && r.feedback !== '' && <Text color={C.red}>{r.feedback}</Text>}

        {!isSettled(r) && !r.isGrading && !r.isSelfCheck && r.wrong.length > 0 && (
          <Box flexDirection="column">
            <Text color={C.red}>✗ {isTyped ? 'Not quite, try again.' : 'Not that one, try again.'}</Text>
            {r.feedback !== '' && rich(r.feedback, C.text)}
          </Box>
        )}

        {!isSettled(r) && r.isSkipped && !r.isSelfCheck && (
          <Box flexDirection="column">
            {rich(`Skipped. Answer: ${answerLabel(q)}`, C.yellow)}
            {q.explanation !== undefined && rich(q.explanation, C.text)}
          </Box>
        )}
      </Box>
    )
  })

  // ---- the Agents panel

  // Every tool call in an agent's loop carries the agent's id: what that agent is doing right now,
  // for its crab's costume and the Now line. It only watches: the call always goes on unchanged,
  // and nothing here waits on the record or can fail the call.
  on('tool.call', ($, e, next) => {
    const call = e as unknown as Record<string, unknown> & { agentId?: unknown; tool?: unknown }
    if (typeof call.agentId === 'string' && call.agentId !== '' && typeof call.tool === 'string') {
      void noteAct($, call.agentId, call.tool, call).catch(() => undefined)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: AGENTS_PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // the terminal draws an Svg as nothing: the crabs are for the surfaces that draw pictures
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined
    const view = await read($, agentsView)
    const acts = await read($, agentActs)
    const live = view.list.filter(s => isLiveAgent(s.status))
    const done = view.list.filter(s => !isLiveAgent(s.status))
    const cost = view.list.reduce((n, s) => n + s.costUsd, 0)
    const tokens = view.list.reduce((n, s) => n + s.tokens, 0)
    // every running agent and the latest finished ones get their crab; older rows stay text alone
    const crabbed = new Set([...live, ...done.slice(0, CRABS_FINISHED)].map(s => s.id))

    const row = (s: AgentSnap) => {
      const isLive = isLiveAgent(s.status)
      const took = (isLive ? Math.max(view.at, s.startedAt) : s.endedAt) - s.startedAt
      const facts = [modelName(s.model), s.effort, fmtTime(took), `${fmtTokens(s.tokens)} tokens`, fmtCost(s.costUsd)]
      const summary = s.doing.replace(/\s+/g, ' ').trim()
      const act = acts[s.id]
      // its pet dresses for what it does now (its latest tool call; thinking before the first),
      // and rests, or shows it stopped, once it is done
      const costume = isLive ? (act?.act ?? 'think') : s.status === 'failed' || s.status === 'killed' ? 'oops' : 'rest'
      // what it does now, from that call; once done, the engine's own last summary
      const doing = isLive ? (act?.doing ?? summary) : summary !== s.description ? summary : (act?.doing ?? '')

      return (
        <Box key={`agent-${s.id}`} flexDirection="row" gap={1} marginBottom={1}>
          {/* the drawing changes only with the costume, so a redraw of the row's figures leaves
              its motion running */}
          {Svg !== undefined && crabbed.has(s.id) && (
            <Svg source={crabSvg(costume, isLive, !isLive)} alt={`crab, ${CRAB_WORD[costume] ?? 'at work'}`} width={40} height={41} />
          )}
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="row" justifyContent="space-between" gap={1}>
              <Text bold wrap="truncate-end">
                {s.description}
              </Text>
              <Text color={agentColor(s.status)}>{AGENT_WORD[s.status] ?? s.status}</Text>
            </Box>
            <Text dimColor wrap="truncate-end">
              {facts.filter(Boolean).join(' · ')}
            </Text>
            {doing !== '' && doing !== s.description && <Text color={C.text}>{`${isLive ? 'Now' : 'Last'}: ${clip(doing, 400)}`}</Text>}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text dimColor>{`${live.length} running · ${done.length} finished · ${fmtCost(cost)} · ${fmtTokens(tokens)} tokens`}</Text>
        {view.list.length === 0 && <Text dimColor>No agents in this session yet.</Text>}
        {live.length > 0 && (
          <Box marginTop={1}>
            <Text bold>Running</Text>
          </Box>
        )}
        {live.map(row)}
        {done.length > 0 && (
          <Box marginTop={1}>
            <Text bold>Finished</Text>
          </Box>
        )}
        {done.map(row)}
        {done.length > 0 && (
          <Button
            key="agents-clear"
            plain
            dimColor
            label="Clear finished"
            onPress={() =>
              void update($, agentsView, v => ({
                ...v,
                list: v.list.filter(s => isLiveAgent(s.status)),
                hidden: [...v.hidden, ...v.list.filter(s => !isLiveAgent(s.status)).map(s => s.id)].slice(-500),
              }))
            }
          />
        )}
      </Box>
    )
  })

  // One panel at a time with the theme picker too: whenever theme-picker opens its picker (the
  // toolbar's Themes, or /themes), the toolbar's own panes close. theme-picker does the same the
  // other way round when one of these opens.
  on('ui.open', { id: 'theme-picker' }, async ($, e, next) => {
    const opened = await next(e)
    try {
      for (const pane of await $.ui.panes()) {
        if (TOOLBAR_PANES.includes(pane.id)) await closeOwnPane($, pane.id)
      }
    } catch {
      // nothing open, or no surface
    }

    return opened
  })

  // the person's own close (the pane's close mark or Escape); the toolbar's closes stop the poll
  // themselves, and the poll checks the pane each tick for the rest
  on('ui.close', { id: AGENTS_PANE }, ($, e, next) => {
    unwatchAgents()

    return next(e)
  })

  // ---- the Side chat panel

  on('ui.render', { component: 'Pane', requestId: SIDE_PANE }, async ($, e) => {
    const { Box, Button, Input, Markdown, Text } = $.ui.resolve(e)
    const s = await read($, sideChat)

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Sees the whole conversation. Nothing here goes into the main chat, and it has no tools.</Text>
        {s.turns.length === 0 && <Text dimColor>Ask a quick question about anything in the chat so far.</Text>}
        {s.turns.map((turn, i) => (
          <Box key={`side-${s.round}-${i}`} flexDirection="column">
            {turn.role === 'you' ? (
              <Text bold color={C.blue}>{`You: ${turn.text}`}</Text>
            ) : turn.role === 'claude' ? (
              <Markdown text={turn.text} />
            ) : (
              <Text color={C.yellow}>{turn.text}</Text>
            )}
          </Box>
        ))}
        {s.isThinking && <Text dimColor>Answering…</Text>}
        <Input key={`side-ask-${s.round}`} placeholder="Ask a side question" submitLabel="send" rows={2} autoFocus onSubmit={value => void askSide($, value).catch(() => undefined)} />
        {s.turns.length > 0 && (
          <Button
            key="side-clear"
            plain
            dimColor
            label="Clear side chat"
            onPress={() => {
              // also a way out of a long wait: the question still out is let go, its answer dropped
              sideAsking = null
              void update($, sideChat, x => ({ turns: [], isThinking: false, round: x.round + 1 }))
            }}
          />
        )}
      </Box>
    )
  })

  // ---- the toolbar: a slim row above the prompt

  // savvy-progress's own band row (a pixel crab and a dismiss mark) stays hidden: the toolbar's
  // Agents panel shows the same agents. The list goes on untouched while that row is not there.
  on('ui.render', { component: 'AbovePromptList' }, ($, e, next) =>
    e.props.rows.some(row => row.plugin === 'savvy-progress')
      ? next({ ...e, props: { ...e.props, rows: e.props.rows.filter(row => row.plugin !== 'savvy-progress') } })
      : next(e),
  )

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refreshContext($)
    // an agent that finishes is read at once, so the panel keeps it after the engine drops it
    if (e.agentId) void refreshAgents($).catch(() => undefined)

    return done
  })

  on('session.measure', async ($, e, next) => {
    const done = await next(e)
    await refreshContext($)

    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // the other mods' bands go beneath this row; the engine's own placeholder is never nested
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const { Box, Button, Text } = $.ui.resolve(e)
    const t = await read($, toolbar)

    // All three panes are this plugin's, so they open at once, mid-reply too, one at a time.
    const onAgents = async () => togglePane($, AGENTS_PANE, 'Agents')
    const onQuiz = async () => togglePane($, PANE, 'Quiz')
    // the keyboard is asked for, not granted: the surface hands it over only while the prompt is empty
    const onSideChat = async () => togglePane($, SIDE_PANE, 'Side chat', true)
    // theme-picker hears this press itself (its own ui.press hook) and opens or closes its picker at
    // once; the toolbar's panes close when the picker opens (the ui.open hook on it). Here only a
    // missing picker is told.
    const onThemes = async () => {
      if (!(await $.command.list()).some(c => c.name === 'themes')) $.ui.toast('Themes opens the theme-picker plugin, which is not on.')
    }
    // compact asks first: an accidental click must not summarize the chat away
    const onCompact = async () => {
      await update($, toolbar, x => ({ ...x, isConfirming: true }))
    }
    // the question goes down; the warning and its percent come back as they stand now, in the same write
    const onCompactNo = async () => {
      const now = await readContext($)
      await update($, toolbar, x => ({ ...x, ...(now ?? {}), isConfirming: false }))
    }
    const onCompactYes = async () => {
      await update($, toolbar, x => ({ ...x, isConfirming: false }))
      try {
        await $.session.compact()
        await refreshContext($)
      } catch {
        // a turn or a background task is running: queue /compact, it runs once the session is idle
        $.ui.toast('Compact queued: it runs as soon as Claude is idle.')
        void $.command
          .run({ command: 'compact' })
          .then(() => refreshContext($))
          .catch(error => $.ui.log(String(error), { to: 'debug' }))
      }
    }
    const run = (f: () => Promise<void>) => () => void f().catch(error => $.ui.log(String(error), { to: 'debug' }))

    return (
      <Box flexDirection="column">
        {t.isConfirming ? (
          <Box gap={2} alignItems="center">
            <Text color={C.yellow}>Compact the conversation? Older messages get summarized.</Text>
            <Button key="tb-compact-yes" variant="primary" label="Yes, compact" onPress={run(onCompactYes)} />
            <Button key="tb-compact-no" label="Cancel" onPress={run(onCompactNo)} />
          </Box>
        ) : (
          // Each button sits centred in a fixed fifth of the row, so nothing one button does under the
          // pointer, nor a label that grows (Compact 65%), moves the others.
          <Box flexDirection="row">
            <Box key="tb-slot-agents" width="20%" justifyContent="center">
              <Button key="tb-agents" plain dimColor label="Agents" onPress={run(onAgents)} />
            </Box>
            <Box key="tb-slot-quiz" width="20%" justifyContent="center">
              <Button key="tb-quiz" plain dimColor label="Quiz" onPress={run(onQuiz)} />
            </Box>
            <Box key="tb-slot-compact" width="20%" justifyContent="center">
              <Button key="tb-compact" plain dimColor={!t.isHot} label={t.isHot ? `Compact ${t.percent}%` : 'Compact'} onPress={run(onCompact)} />
            </Box>
            <Box key="tb-slot-side" width="20%" justifyContent="center">
              <Button key="tb-side" plain dimColor label="Side chat" onPress={run(onSideChat)} />
            </Box>
            <Box key="tb-slot-themes" width="20%" justifyContent="center">
              <Button key="tb-themes" plain dimColor label="Themes" onPress={run(onThemes)} />
            </Box>
          </Box>
        )}
        {below}
      </Box>
    )
  })
}
