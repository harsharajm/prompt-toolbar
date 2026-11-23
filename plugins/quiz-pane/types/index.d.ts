// where a question leads: another question's id, or 'end' to finish
export type Route = string

export type QuizQuestion = {
  // names the question so others can lead to it
  id?: string
  // choice (default): pick an option. number: type a number. text: type a short answer.
  // reasoning: explain in your own words, graded by a model against `answer`.
  type: 'choice' | 'number' | 'text' | 'reasoning'
  question: string
  // a picture shown under the question: https URL, data: URI, or a local file path (png, jpg, gif, webp, svg)
  image?: string
  // what the picture shows, for a reader that cannot see it
  imageAlt?: string
  // choice only
  options: string[]
  // choice: index into options (0-based). number: the value. text, reasoning: the reference answer.
  answer: number | string
  // number: how far off still counts (default 0.01)
  tolerance?: number
  unit?: string
  // text: any of these phrases in the reply is right (case and punctuation ignored)
  accept?: string[]
  // text: every one of these words or phrases must appear in the reply
  keywords?: string[]
  explanation?: string
  // branching; a question with none moves on to the next in the list
  goto?: {
    // when answered right
    correct?: Route
    // when left after only wrong tries
    wrong?: Route
    // per option: picking it settles the question and leads here (null: no route)
    options?: (Route | null)[]
  }
}

// how one question went
export type Result = {
  // wrong tries: an option index as text, or what was typed
  wrong: string[]
  isSolved: boolean
  // settled wrong by a pick that leads somewhere: no retry
  isMissed: boolean
  // left with the next arrow before it was settled
  isSkipped: boolean
  // solved with no wrong try and no skip
  isFirstTry: boolean
  // a model is checking the reply
  isGrading: boolean
  // no model could grade: the person compares with the reference and marks it
  isSelfCheck: boolean
  // where this question leads, once a pick set it; '' none
  routed: string
  // the typed reply that was accepted
  input: string
  // a line from the grader
  feedback: string
}

export type QuizState = {
  title: string
  questions: QuizQuestion[]
  // the question on screen
  index: number
  // the questions walked through before this one, oldest first
  history: number[]
  // one per question
  results: Result[]
  // the summary is showing
  isDone: boolean
}

// the toolbar above the prompt
export type ToolbarState = {
  // the context has passed the safe threshold: the compact button lights up
  isHot: boolean
  // context used, percent of the window
  percent: number
  // the compact button was clicked: the band asks before compacting
  isConfirming: boolean
}

// one agent as the Agents panel last read it from the engine's own record
export type AgentSnap = {
  id: string
  description: string
  type: string
  // the engine's status (running, completed, failed, ...), or 'ended' once the
  // engine dropped the record of an agent last seen running
  status: string
  // what it is doing: the engine's latest progress summary, else its description
  doing: string
  model: string
  effort: string
  startedAt: number
  // when it was first seen finished; 0 while it runs
  endedAt: number
  // tokens over all its requests
  tokens: number
  // how full its context window was at its latest request, percent
  context: number
  // what /cost credited its requests, US dollars
  costUsd: number
}

export type AgentsView = {
  // when the engine's record was last read: a running agent's clock
  at: number
  // running first, then finished, newest first in each
  list: AgentSnap[]
  // finished agents the person cleared from the panel
  hidden: string[]
}

// what an agent is doing, from its latest tool call: its crab's costume and the panel's Now line
export type AgentAct = {
  // think, read, search, write, run, wait, web, delegate or tool
  act: string
  // a few words: Writing bo-3.txt, Waiting 15s, ...
  doing: string
  // when the call started
  at: number
}

export type SideTurn = {
  // you: the person's question; claude: an answer; note: why no answer came
  role: 'you' | 'claude' | 'note'
  text: string
}

export type SideChatState = {
  turns: SideTurn[]
  // a question is out with the model
  isThinking: boolean
  // counts questions sent: the input box is keyed by it, so it starts empty after each one
  round: number
}

declare module 'claude-code' {
  interface PluginState {
    'quiz-pane': {
      quiz: Shaped<QuizState>
      toolbar: Shaped<ToolbarState>
      agents: Shaped<AgentsView>
      acts: Shaped<Record<string, AgentAct>>
      side: Shaped<SideChatState>
    }
  }
}
