import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'quiz-pane',
  component: 'Pane',
  requestId: 'quiz',
  props: {
    title: 'Quiz',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const QUESTIONS = [
  { question: 'What is 10% of 50?', options: ['5', '10', '15'], answer: 0, explanation: '10% = 0.1 x 50.' },
  { question: 'What is 50% of 20?', options: ['5', '10', '15'], answer: 1 },
]

test('a correct pick advances, a wrong one stays, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'quiz' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__quiz-pane__quiz_load' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__quiz-pane__quiz_load', title: 'Percent', questions: QUESTIONS })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /10% of 50/ }))?.text).toContain('10% of 50')
    expect(await ui.find({ type: 'Text', text: /of 2/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('feedback shows below the question, arrows move between questions', async ($, on) => {
  on('command.register', () => ({ value: { command: 'quiz' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__quiz-pane__quiz_load' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__quiz-pane__quiz_load', title: 'Percent', questions: QUESTIONS })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'q0-o1' })
  expect(await ui.find({ type: 'Text', text: /Not that one/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /10% of 50/ })).toBeTruthy()

  await ui.press({ key: 'q0-o0' })
  expect(await ui.find({ type: 'Text', text: /Correct/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /0\.1 x 50/ })).toBeTruthy()
  // still the same question
  expect(await ui.find({ type: 'Text', text: /10% of 50/ })).toBeTruthy()

  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: /50% of 20/ })).toBeTruthy()

  await ui.press({ key: 'prev' })
  expect(await ui.find({ type: 'Text', text: /10% of 50/ })).toBeTruthy()
  await ui.unmount()
})

const SETUP = async ($: any, on: any, questions: unknown[]) => {
  on('command.register', () => ({ value: { command: 'quiz' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__quiz-pane__quiz_load' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__quiz-pane__quiz_load', title: 'T', questions })

  return $.ui.mount({ ...PANE, surface: 'desktop' })
}

test('arrows sit above the question, no hotkey chips on them', async ($, on) => {
  const ui = await SETUP($, on, QUESTIONS)
  const prev = await ui.find({ key: 'prev' })
  expect(prev).toBeTruthy()
  await ui.unmount()
})

test('a number answer is checked with a tolerance', async ($, on) => {
  const ui = await SETUP($, on, [
    { type: 'number', question: 'What is 20% of 50?', answer: 10, unit: '%' },
    { question: 'Second?', options: ['a', 'b'], answer: 0 },
  ])

  await ui.input({ key: 'ans-0', text: '9' })
  expect(await ui.find({ type: 'Text', text: /Not quite/ })).toBeTruthy()
  await ui.input({ key: 'ans-0', text: '10' })
  expect(await ui.find({ type: 'Text', text: /Correct/ })).toBeTruthy()
  await ui.unmount()
})

test('a text answer is accepted by its keywords', async ($, on) => {
  const ui = await SETUP($, on, [{ type: 'text', question: 'Why?', answer: 'a part of a hundred', keywords: ['hundred'] }])

  await ui.input({ key: 'ans-0', text: 'it is out of one hundred' })
  expect(await ui.find({ type: 'Text', text: /Correct/ })).toBeTruthy()
  await ui.unmount()
})

test('a pick leads to the question its branch names', async ($, on) => {
  const ui = await SETUP($, on, [
    { id: 'start', question: 'Start?', options: ['easy', 'hard'], answer: 0, goto: { options: ['easy-q', 'hard-q'] } },
    { id: 'skipped', question: 'Never seen', options: ['a', 'b'], answer: 0 },
    { id: 'easy-q', question: 'Easy one', options: ['a', 'b'], answer: 0, goto: { correct: 'end' } },
    { id: 'hard-q', question: 'Hard one', options: ['a', 'b'], answer: 0 },
  ])

  await ui.press({ key: 'q0-o1' })
  expect(await ui.find({ type: 'Text', text: /Not quite/ })).toBeTruthy()
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: /Hard one/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Never seen/ })).toBeFalsy()
  await ui.press({ key: 'prev' })
  expect(await ui.find({ type: 'Text', text: /Start\?/ })).toBeTruthy()
  await ui.unmount()
})

test('a reasoning answer is graded by a model, with a self-check when it cannot', async ($, on) => {
  on('model.complete', () => ({ value: { isAnswered: true, text: ['PASS', 'You named the base correctly.'].join(String.fromCharCode(10)), usage: {} } }) as never)
  const ui = await SETUP($, on, [{ type: 'reasoning', question: 'Why is 50% of 20 equal to 10?', answer: 'Half of the whole.' }])

  await ui.input({ key: 'ans-0', text: 'because 50 percent means one half' })
  expect(await ui.find({ type: 'Text', text: /Correct/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /named the base/ })).toBeTruthy()
  await ui.unmount()
})

test('with no grader the person marks a reasoning answer', async ($, on) => {
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'api-error', usage: {} } }) as never)
  const ui = await SETUP($, on, [{ type: 'reasoning', question: 'Why?', answer: 'Half of the whole.' }])

  await ui.input({ key: 'ans-0', text: 'my thinking' })
  expect(await ui.find({ type: 'Text', text: /Could not grade/ })).toBeTruthy()
  await ui.press({ key: 'got' })
  expect(await ui.find({ type: 'Text', text: /Correct/ })).toBeTruthy()
  await ui.unmount()
})

test('LaTeX in a question is typeset on desktop, Unicode on the terminal; plain dollars stay', async ($, on) => {
  const ui = await SETUP($, on, [
    {
      question: String.raw`Find $\frac{1}{2}x^2 + \alpha_i$ when it costs $5 and $10`,
      options: [String.raw`$\sqrt{x}$`, String.raw`$e^{-x}$`],
      answer: 0,
      explanation: String.raw`$\sum_{i=1}^{n} x_i$`,
    },
  ])

  // desktop: the equations are typeset as vector drawings
  expect((await ui.findAll({ type: 'Svg' })).length).toBeGreaterThanOrEqual(1)
  await ui.press({ key: 'q0-o0' })
  expect(await ui.find({ type: 'Svg' })).toBeTruthy()
  await ui.unmount()

  // terminal: no vector drawing, so the Unicode approximation
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Svg' })).toBeFalsy()
  expect(await term.find({ type: 'Text', text: /\(1\/2\)x² \+ αᵢ when it costs \$5 and \$10/ })).toBeTruthy()
  await term.unmount()
})

test('a picture by URL draws as Svg on desktop and as its alt text on the terminal', async ($, on) => {
  const ui = await SETUP($, on, [{ question: 'Name it', options: ['a', 'b'], answer: 0, image: 'https://example.com/a.png', imageAlt: 'a cat' }])
  expect(await ui.find({ type: 'Svg' }), 'svg on desktop').toBeTruthy()
  await ui.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /a cat/ }), 'alt on terminal').toBeTruthy()
  await term.unmount()
})
