// Pixel crabs for the Agents panel: one pet per agent, dressed for what the agent is doing right
// now (reading, writing, running a command, waiting, ...), moving while it works and resting once
// it is done.
//
// The crab, its walk and the detective's costume are adapted from savvy-progress 1.2.1
// (hooks/register.tsx) by johnnyvizz, https://github.com/johnnyvizz/claude-kit, which credits the
// crab, Clawd, to DockCrab (Clawdy). savvy-progress is released under the MIT License:
//
//   Copyright (c) johnnyvizz
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
//   and associated documentation files (the "Software"), to deal in the Software without
//   restriction, including without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all copies or
//   substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
//   BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

const CLAY = '#D97757'
const INK = '#1F1E1D'
const PAPER = '#F4F3EE'
const RULE = '#B9B7AE'
const WOOD = '#7A4A26'
const STEEL = '#8E929A'

// every costume, by the action it shows, and the words for it (the drawing's alt text)
export const CRAB_WORD: Record<string, string> = {
  think: 'thinking',
  read: 'reading',
  search: 'searching',
  write: 'writing',
  run: 'running a command',
  wait: 'waiting',
  web: 'browsing the web',
  delegate: 'handing work to another agent',
  tool: 'using a tool',
  rest: 'done',
  oops: 'stopped',
}

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its costume, `la`/`lb`
// the leg pairs, anything else a prop with its own motion
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

// a 24x18 crab on a 30x28 grid; `armCls` lets a raised claw travel with the prop it holds
const crabBody = (f: Fill, armFront = 0, armCls?: string, eyes: 'open' | 'shut' | 'x' = 'open'): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  for (const x of [9, 19]) {
    if (eyes === 'open') f(x, 12, 2, 2, INK)
    if (eyes === 'shut') f(x, 13, 2, 1, INK)
    if (eyes === 'x') {
      f(x - 1, 11, 1, 1, INK)
      f(x + 1, 11, 1, 1, INK)
      f(x, 12, 1, 1, INK)
      f(x - 1, 13, 1, 1, INK)
      f(x + 1, 13, 1, 1, INK)
    }
  }
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Pure CSS, run by the compositor: the motion needs no redraws. Every crab at work walks; each
// costume adds its prop's own motion. Reduced motion holds them all still.
const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}@keyframes blink{50%{opacity:.15}}
.c-think.run .d1{animation:blink 1.2s steps(1) infinite}.c-think.run .d2{animation:blink 1.2s steps(1) infinite -.8s}.c-think.run .d3{animation:blink 1.2s steps(1) infinite -.4s}
.c-read.run .pg{animation:blink 1s steps(1) infinite}
.c-search.run .it{animation:scan 1s steps(1) infinite}.c-search.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-write.run .pen{animation:scrib .3s steps(1) infinite}.c-write.run .ink{animation:blink .6s steps(1) infinite}
@keyframes scrib{50%{transform:translateX(-1px)}}
.c-run.run .cur{animation:blink .8s steps(1) infinite}.c-run.run .key{animation:st .25s steps(1) infinite}
.c-wait.run .la,.c-wait.run .lb{animation:none}.c-wait.run .bd{animation:breathe 2s ease-in-out infinite}
.c-wait.run .z1{animation:zz 2s linear infinite}.c-wait.run .z2{animation:zz 2s linear infinite -1s}
@keyframes breathe{50%{transform:translateY(1px)}}@keyframes zz{0%{transform:translateY(2px);opacity:0}30%{opacity:1}100%{transform:translateY(-3px);opacity:0}}
.c-web.run .scope{transform-origin:0 100%;animation:peer 2s ease-in-out infinite}@keyframes peer{50%{transform:rotate(-10deg)}}
.c-delegate.run .mega{animation:st .3s steps(1) infinite}.c-delegate.run .w1{animation:blink .6s steps(1) infinite}.c-delegate.run .w2{animation:blink .6s steps(1) infinite -.3s}
.c-tool.run .ham{transform-origin:50% 100%;animation:swing .5s ease-in-out infinite}@keyframes swing{50%{transform:rotate(-30deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const COSTUMES: Record<string, (f: Fill) => void> = {
  // thinking: a thought bubble whose dots pulse in turn
  think: f => {
    crabBody(f)
    stamp(f, 19, -3, ['..wwwwww..', '.wwwwwwww.', 'wwwwwwwwww', 'wwwwwwwwww', '.wwwwwwww.', '..wwwwww..'], { w: PAPER })
    f(21, 0, 1, 1, INK, 'd1')
    f(24, 0, 1, 1, INK, 'd2')
    f(27, 0, 1, 1, INK, 'd3')
    f(20, 4, 2, 2, PAPER)
    f(19, 7, 1, 1, PAPER)
  },
  // reading: an open book resting on the raised claw, a page turning
  read: f => {
    crabBody(f, -4)
    stamp(f, 19, 5, ['bbbbbbbbbbb', 'bwllwbwllwb', 'bwwwwbwwwwb', 'bwllwbwllwb', 'bwwwwbwwwwb', 'bbbbbbbbbbb'], { b: WOOD, w: PAPER, l: RULE })
    f(25, 6, 4, 4, '#FFFFFF', 'pg')
  },
  // searching: the detective, deerstalker and magnifier, sweeping
  search: f => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: WOOD, c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, '#D85A30')
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it')
    f(25, 6, 1, 4, WOOD, 'it')
    f(24, 2, 1, 1, '#fff', 'gl')
  },
  // writing: a pencil in the claw scribbling on a sheet, the fresh line flickering
  write: f => {
    crabBody(f)
    stamp(f, 23, 19, ['wwwwwww', 'wllllww', 'wwwwwww', 'wwwwwww', 'wwwwwww'], { w: PAPER, l: RULE })
    f(24, 22, 3, 1, '#3A3A3C', 'ink')
    f(27, 11, 1, 1, '#E59AA5', 'pen')
    f(27, 12, 1, 1, '#C9CCD2', 'pen')
    f(27, 13, 1, 4, '#F5C542', 'pen')
    f(27, 17, 1, 1, '#E8C9A0', 'pen')
    f(27, 18, 1, 1, INK, 'pen')
  },
  // running a command: a little terminal, the claw typing, the cursor blinking
  run: f => {
    crabBody(f, 0, 'key')
    stamp(f, 20, 0, ['gggggggggg', 'gkkkkkkkkg', 'gkGkkkkkkg', 'gkkGkkkkkg', 'gkGkkkkkkg', 'gkkkkkkkkg', 'gggggggggg'], { g: STEEL, k: INK, G: '#5FD38D' })
    f(25, 4, 2, 1, '#5FD38D', 'cur')
    f(24, 7, 2, 2, STEEL)
  },
  // waiting: eyes shut, breathing slowly, z's drifting up
  wait: f => {
    crabBody(f, 0, undefined, 'shut')
    stamp(f, 23, 3, ['zzz', '.z.', 'zzz'], { z: '#C9D7F5' }, 'z1')
    stamp(f, 25, -2, ['zzzz', '..z.', '.z..', 'zzzz'], { z: '#E6ECFA' }, 'z2')
  },
  // browsing the web: an explorer's hat and a spyglass, peering about
  web: f => {
    crabBody(f, -4, 'scope')
    stamp(f, 7, 6, ['.....hhhhhh.....', '....hhhhhhhh....', '....bbbbbbbb....', 'hhhhhhhhhhhhhhhh'], { h: '#C8B47E', b: '#7A5A2E' })
    f(25, 8, 2, 2, WOOD, 'scope')
    f(26, 7, 2, 2, '#B08D57', 'scope')
    f(27, 6, 2, 2, WOOD, 'scope')
    f(28, 5, 2, 2, '#5A3519', 'scope')
    f(29, 5, 1, 1, '#A9D6F5', 'scope')
  },
  // handing work to another agent: a megaphone, sound waves going out
  delegate: f => {
    crabBody(f, -4, 'mega')
    stamp(f, 23, 6, ['...ow', '.ooow', 'oooow', '.ooow', '...ow'], { o: '#E8743B', w: '#F8F6F1' }, 'mega')
    f(28, 7, 1, 3, '#F8F6F1', 'w1')
    f(29, 6, 1, 5, '#F8F6F1', 'w2')
  },
  // any other tool: a hammer, swinging
  tool: f => {
    crabBody(f, -4, 'ham')
    f(26, 4, 1, 6, WOOD, 'ham')
    f(24, 2, 5, 2, STEEL, 'ham')
    f(24, 2, 5, 1, '#C9CCD2', 'ham')
  },
  // done: resting, a green check above
  rest: f => {
    crabBody(f)
    for (const [x, y] of [[12, 6], [13, 7], [14, 8], [15, 7], [16, 6], [17, 5], [18, 4]] as const) f(x, y, 1, 1, '#3B9C5F')
  },
  // stopped or failed: X eyes, a red mark above
  oops: f => {
    crabBody(f, 0, undefined, 'x')
    f(15, 2, 1, 4, '#D0453F')
    f(15, 7, 1, 1, '#D0453F')
  },
}

// One crab as a whole SVG document. The same costume and state always give the same text, so a
// redraw of the row hands the surface an unchanged drawing and the motion runs on undisturbed.
export const crabSvg = (costume: string, isWalking: boolean, isResting: boolean): string => {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (x, y, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  const draw: (f: Fill) => void = COSTUMES[costume] ?? ((g: Fill) => crabBody(g))
  draw(f)
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="31" viewBox="0 -3 30 31">${CRAB_CSS}<g opacity="${isResting ? 0.6 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g></svg>`
}
