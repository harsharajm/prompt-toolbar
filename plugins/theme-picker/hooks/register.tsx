import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, Timer } from 'claude-code'

import {
  NIGHT_GLASS,
  NIGHT_ID,
  SHOW_SUFFIXES,
  WORD,
  nightScene,
  sceneWithFireworks,
  themeIdOfShow,
} from './fireworks'
import { loadAddedThemes } from './added-themes'
import type { AddedReport } from './added-themes'
import { overShader } from './interactive'
import type { Sound } from './sounds'
import { THEMES, sceneFault, sceneOf } from './themes'
import type { Theme } from './themes'
import type { PickerView, ThemeChoice } from '../types'

const PLUGIN = 'theme-picker'
const PANE = 'theme-picker'
// Not `theme`: that is the engine's own command (the terminal's color theme).
const COMMAND = 'custom-theme'
// The picker's own name for the same: no other plugin answers it.
const OWN_COMMAND = 'themes'
// The picker shows its tiles four to a row, and the pane scrolls through them.
const COLUMNS = 4
// Where a pick on the picker applies, as the person last chose it: kept across sessions.
const SCOPE_KEY = 'picker:scope'
// A scene's own rule for reduced motion. Forced on, it gives the scene's resting picture, which a preview shows.
const RESTING_RULE = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/g
const FIREWORKS_COMMAND = 'fireworks'
const SHOW_MS = 7000
// The desktop app starts a moving picture about two and a half seconds after a shader leaves the window, so a show over
// a theme with a shader runs that much longer, or its last bursts are cut. Where its shader was not playing, the show
// only ends on the theme's own still for that long.
const SHADER_PARTING_MS = 2500
// Holds 'off' where the person turned the show on the word off; absent, it is on. One key for every session and project.
const AUTO_KEY = 'fireworks:auto'
const SESSION_PREFIX = 'session:'
// How many sessions' own choices the store keeps: past it, the one written longest ago goes.
const SESSIONS_KEPT = 200
// Said where a theme is set and the engine answers that nothing draws it. That answer is what the attached windows said of themselves at the moment of
// the set: one that attaches later still draws the theme, and one that draws themes under another name than this engine asks after draws it all the
// same. An engine with none of the three calls is answered the same way (setWithoutSound's last line), and there nothing draws it. So the words hold
// whether or not the theme shows, and never say why.
const UNSHOWN = 'If no theme shows, this window may not draw themes yet'
const KEPT_UNSHOWN = `${UNSHOWN}. Your choice is saved.`
const SHOW_UNSHOWN = 'If none shows, this window may not draw them yet.'
// The module's own variables start over on a reload: so does a show in flight, which is fine for a show.
// `starting` from the tick a show is asked for until its timer stands: see `fireworks`.
let showEnding: Timer | 'starting' | undefined
let showCount = 0
// The loader's scan reads these references: both names are written as string literals.
const choice = atom({ plugin: 'theme-picker', key: 'choice' } as const, {}, {
  shape: 'choice-1',
})
// The tag changes with the value's fields: a reload declines what an earlier version stored (view-1 had pages).
const view = atom({ plugin: 'theme-picker', key: 'view' } as const, { filter: 'all', scope: 'session', rev: 0 }, {
  shape: 'view-2',
})

/** What a set comes to on any engine, as far as this mod reads it: drawn or not. */
type BackdropAnswer = { isDrawn: boolean }
type BackdropChoice = { id: string; glass: Theme['glass']; colorScheme?: Theme['window']; sound?: Sound }
/**
 * The engines this mod meets, for the type checker alone: the theme noun or the older call may be absent.
 * A CALL ON A MEMBER THAT MAY BE ABSENT IS WRITTEN PLAINLY, as $.noun.method(...), under a line of "@ts-expect-error". A "!" or a
 * "?." on the call would satisfy the type checker too, but a plain call is one that a tool reading a mod's source as written, without
 * compiling it, such as the plugin directory's validator, can follow. That line covers the call's own line and no other, so what the
 * call is given stands on lines of its own or in a const above it, where the type checker still reads it.
 */
type AnyEngine = {
  theme?: { set(args: unknown): Promise<BackdropAnswer>; clear(): Promise<unknown> }
  // `toast` is named only so that this type shares a member with every engine's ui noun: the checker refuses one that shares none.
  ui: {
    toast: EngineInterface['ui']['toast']
    log: EngineInterface['ui']['log']
    backdrop?(args: BackdropChoice | undefined): Promise<BackdropAnswer>
  }
}
// The way of setting a backdrop this engine took, learnt at the first set that can tell; a reload learns it again.
let taken: 'beside' | 'nested' | 'older' | 'none' | undefined
// True once an engine has refused a set as holding an attribute "sound" that it does not know: no theme's sound is then tried; a reload learns it again.
let engineLacksSound = false
// The last failed set with sound told to the debug log, as the theme's id and the reason: told again only when either changes.
let toldSoundFailure: string | undefined

/**
 * A try may be followed by the next one only where the engine lacks the call (reaching for it throws a TypeError) or
 * refuses the shape as one it does not know: in its own words for that, or by naming the member that this try alone
 * bears, should those words ever move. Any other fault is the caller's to see.
 * NO CALL IS ASKED AFTER AHEAD OF ITS TRY: the engine loads a module only where each call on its handle is called on the
 * spot; one that is read, bound or passed keeps the whole module from loading. So each is made, and its fault judged.
 */
function isNotThisEnginesWay(error: unknown, member?: string): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      (error.message.includes('does not know the attribute') || (member !== undefined && error.message.includes(member))))
  )
}

/** The arguments of a set in the newest shape, without a sound. */
function newestShape(backdrop: BackdropChoice): Record<string, unknown> {
  return {
    backdrop: { scene: backdrop.id, id: backdrop.id, glass: backdrop.glass },
    ...(backdrop.colorScheme !== undefined && { overrideColorScheme: backdrop.colorScheme }),
  }
}

/** Notes that the engine took a set in the newest shape. */
function learnNewest(backdrop: BackdropChoice): void {
  // With no kind to hand over this shape is the next one's too: it tells nothing of the engine, so nothing is learnt.
  // A belt: learnt wrongly here, the next set with a kind would be refused once and the ways walked anew.
  if (backdrop.colorScheme !== undefined) {
    taken = 'beside'
  }
}

/**
 * Sets a backdrop by whichever call this engine has: the theme noun with the window's kind beside the backdrop, the
 * theme noun with it inside the backdrop, or the older call on the ui noun. The calls are written out plainly, each in
 * its own try: a call the engine lacks throws as it is reached for, and a shape it does not take it refuses. THE NEWEST FIRST: an engine that
 * wants the kind beside the backdrop takes the one inside it too, and drops it without a word.
 * THE SCENE's NAME GOES UNDER TWO NAMES AT ONCE in the newest shape: the newest engines read `scene`, the ones before
 * them `id`. Each engine's own theme noun lets the members it knows cross and drops any other, so one shape serves both;
 * a backdrop with the one name alone is refused by the engines that read the other, in words that name no unknown attribute.
 * Answers nothing where no way was taken.
 */
async function setByAWay($: AnyEngine, backdrop: BackdropChoice): Promise<BackdropAnswer | undefined> {
  if (taken === undefined || taken === 'beside') {
    try {
      const shape = newestShape(backdrop)
      // @ts-expect-error An engine may lack this call: see AnyEngine.
      const set = await $.theme.set(shape)

      learnNewest(backdrop)

      return set
    } catch (error) {
      if (!isNotThisEnginesWay(error, 'overrideColorScheme')) throw error
    }
  }

  if (taken === undefined || taken === 'nested') {
    try {
      // @ts-expect-error An engine may lack this call: see AnyEngine.
      const set = await $.theme.set({
        backdrop: {
          id: backdrop.id,
          glass: backdrop.glass,
          ...(backdrop.colorScheme !== undefined && { colorScheme: backdrop.colorScheme }),
        },
      })
      taken = 'nested'

      return set
    } catch (error) {
      if (!isNotThisEnginesWay(error)) throw error
    }
  }

  if (taken === undefined || taken === 'older') {
    try {
      // The older call is given the id and the glass alone.
      const older: BackdropChoice = { id: backdrop.id, glass: backdrop.glass }
      // @ts-expect-error An engine may lack this call: see AnyEngine.
      const set = await $.ui.backdrop(older)
      taken = 'older'

      return set
    } catch (error) {
      if (!isNotThisEnginesWay(error)) throw error
    }
  }

  return undefined
}

/**
 * A way once learnt is the only one tried. Where the engine does not take it after all the ways are walked anew; an
 * engine with none of them draws nothing, and the answer says so.
 */
async function setWithoutSound($: AnyEngine, backdrop: BackdropChoice): Promise<BackdropAnswer> {
  if (taken === 'none') {
    return { isDrawn: false }
  }

  const learnt = taken
  const set = await setByAWay($, backdrop)

  if (set !== undefined) {
    return set
  }

  if (learnt !== undefined) {
    taken = undefined

    const again = await setByAWay($, backdrop)

    if (again !== undefined) {
      return again
    }
  }

  taken = 'none'

  return { isDrawn: false }
}

/**
 * Whether a refused set shows that the engine is from before sound: it says that it does not know the attribute
 * "sound". Any other failure, a refused member inside a sound too, proves nothing about the engine, so the next
 * theme's sound is still tried.
 */
function isEngineWithoutSound(error: unknown): boolean {
  return error instanceof Error && error.message.includes('does not know the attribute "sound"')
}

/**
 * Says which theme could not be set with its sound and why, so that whoever changes a sound can read what to change.
 * The failure may not be the sound's own, so the words say only what happened.
 * TO THE DEBUG LOG ALONE, as `tellKeyStep` is: the person sees the theme, without its sound.
 */
async function tellSoundFailure($: AnyEngine, id: string, reason: string): Promise<void> {
  const told = `${id}: ${reason}`

  if (told === toldSoundFailure) {
    return
  }

  toldSoundFailure = told

  try {
    await $.ui.log(`The theme ${id} could not be set with its sound, so it was set without it: ${reason}`, { to: 'debug' })
  } catch {
    // An engine without that call, or one that refuses it: nothing more to tell.
  }
}

/**
 * Sets a backdrop, with its sound where the theme has one and the engine takes it.
 * THE SET WITH SOUND IS A TRY OF ITS OWN, AHEAD OF THE WAYS: were it the first way, an engine from before sound would
 * refuse it in words that way's catch reads as "try the next shape", then refuse the next shape, and the theme would
 * not be applied. After any failure here the theme is set without the sound; where that fails too, its error is thrown.
 */
async function setBackdrop($: AnyEngine, backdrop: BackdropChoice): Promise<BackdropAnswer> {
  // Only an engine that takes the newest shape can take sound, so no other is asked.
  if (backdrop.sound === undefined || engineLacksSound || (taken !== undefined && taken !== 'beside')) {
    return setWithoutSound($, backdrop)
  }

  let failure: unknown

  try {
    const shape = { ...newestShape(backdrop), sound: backdrop.sound }
    // @ts-expect-error An engine may lack this call: see AnyEngine.
    const set = await $.theme.set(shape)

    learnNewest(backdrop)

    return set
  } catch (error) {
    failure = error
  }

  const set = await setWithoutSound($, backdrop)

  if (isEngineWithoutSound(failure)) {
    engineLacksSound = true
  } else if (taken === 'beside') {
    // Told only where the newest way took the theme. A show bears its theme's sound under the show's own id: the theme is the one to name.
    await tellSoundFailure($, themeIdOfShow(backdrop.id) ?? backdrop.id, reasonOf(failure))
  }

  return set
}

/** Clears the backdrop by whichever call this engine has; an engine with neither is left alone. */
async function clearBackdrop($: AnyEngine): Promise<void> {
  try {
    // @ts-expect-error An engine may lack this call: see AnyEngine.
    await $.theme.clear()

    return
  } catch (error) {
    if (!isNotThisEnginesWay(error)) throw error
  }

  try {
    // @ts-expect-error An engine may lack this call: see AnyEngine.
    await $.ui.backdrop(undefined)
  } catch (error) {
    if (!isNotThisEnginesWay(error)) throw error
  }
}

/**
 * The scene's name as the engine hands it to the Backdrop hook: under `scene` on the newest engines, under `id` on the
 * ones before them. Read under either, the newer first: a hook that knew the one name alone would find no theme on the
 * other engines and pass the ask on, and nothing would say so.
 */
function sceneNameOf(props: { scene?: unknown; id?: unknown }): string | undefined {
  if (typeof props.scene === 'string') {
    return props.scene
  }

  return typeof props.id === 'string' ? props.id : undefined
}

function themeOf(id: string | undefined): Theme | undefined {
  return THEMES.find(theme => theme.id === id)
}

/** A name as typed, a title as shown and an id all come to one key: lower case, each run of anything else a hyphen. */
function keyOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** The theme a person named: by its id or its title, in any case, with spaces or hyphens between the words. */
function themeNamed(text: string): Theme | undefined {
  const key = keyOf(text)

  return THEMES.find(theme => theme.id === key || keyOf(theme.title) === key)
}

/** How many single-letter edits turn one word into the other. */
function editsBetween(from: string, to: string): number {
  let row = Array.from({ length: to.length + 1 }, (_, column) => column)

  for (let line = 1; line <= from.length; line += 1) {
    const next = [line]

    for (let column = 1; column <= to.length; column += 1) {
      const swap = (row[column - 1] ?? 0) + (from[line - 1] === to[column - 1] ? 0 : 1)

      next.push(Math.min(swap, (row[column] ?? 0) + 1, (next[column - 1] ?? 0) + 1))
    }

    row = next
  }

  return row[to.length] ?? 0
}

/**
 * The theme whose name is nearest a mistyped one. A few edits away speaks first (one id can be the start of another:
 * plotter-tide and plotter-tide-night); else the longest id the typed name starts with (a name with a wrong word behind
 * it); else the first id that starts with what was typed; else none.
 */
function nearestTheme(text: string): Theme | undefined {
  const key = keyOf(text)

  if (key === '') return undefined

  const byEdits = THEMES.map(theme => ({ theme, edits: editsBetween(key, theme.id) })).sort(
    (one, other) => one.edits - other.edits,
  )
  const nearest = byEdits[0]

  if (nearest !== undefined && nearest.edits <= Math.max(2, Math.floor(key.length / 3))) {
    return nearest.theme
  }

  const startsIt = THEMES.filter(theme => key.startsWith(theme.id)).sort(
    (one, other) => other.id.length - one.id.length,
  )

  return startsIt[0] ?? THEMES.find(theme => theme.id.startsWith(key))
}

/** The two kinds of window, in the order the list and the card show them. */
const WINDOWS = ['dark', 'light'] as const

/** The themes made for one kind of window, a row each: the name to type, its title, what it is, and its twin's name. */
function rowsFor(window: Theme['window']): string[] {
  return THEMES.filter(theme => theme.window === window).map(theme => {
    const twin = themeOf(theme.twin)

    return `  ${theme.id}: ${theme.title}. ${theme.blurb}${twin === undefined ? '' : ` (for ${twin.window} windows: ${twin.id})`}`
  })
}

/** Every theme by the name to type, under the window it is made for. */
function themeList(): string {
  return [
    `Themes (${THEMES.length}):`,
    ...WINDOWS.flatMap(window => [`For ${window} windows:`, ...rowsFor(window)]),
    `/${COMMAND} alone opens the picker. /${COMMAND} <name> applies one to all chats; add "chat" for this chat only. /${COMMAND} off clears it.`,
  ].join('\n')
}

/** What a set of a theme's backdrop carries. `id`: the theme's own, or a show's over it. */
function backdropOf(theme: Theme, id = theme.id): BackdropChoice {
  return { id, glass: theme.glass, colorScheme: theme.window, sound: theme.sound }
}

/**
 * Shows a theme behind the chat, or with none clears the session's theme, and answers what a set came to.
 * A clear takes away whatever theme stands, whichever mod set it, so `show` is given none only on a person's ask
 * (off, a preview's end, a show's end) or to take a theme of this mod's own away, never over a window it left bare.
 */
async function show($: EngineInterface, id: string | undefined): Promise<BackdropAnswer | undefined> {
  const theme = themeOf(id)

  if (theme === undefined) {
    await clearBackdrop($)

    return undefined
  }

  return setBackdrop($, backdropOf(theme))
}

// The one key the choice for all chats is stored under. theme-examples kept one choice per project; this fork keeps one
// for every chat, which a chat's own choice stands over.
const ALL_CHATS_KEY = 'all-chats'

/** The keys the choice for all chats is read under, in order; the one it is written under; the ones a clear takes away. */
type AllChatsKeys = { toRead: string[]; write: string; clear: string[] }

function allChatsKeys(): AllChatsKeys {
  return { toRead: [ALL_CHATS_KEY], write: ALL_CHATS_KEY, clear: [ALL_CHATS_KEY] }
}

/** What the store keeps for one session: its own theme's id, or null where it chose none. */
type SessionChoice = { theme: string | null }

/** An id an engine may not offer: a fault counts as no answer. */
async function orNothing(ask: () => Promise<string | undefined>): Promise<string | undefined> {
  try {
    return await ask()
  } catch {
    return undefined
  }
}

/**
 * The key a session's own choice is stored under: one per row a person sees in the desktop app, else one per
 * Claude Code session. An empty id counts as none. With neither id there is no key, and the choice lasts as long
 * as this process does.
 */
async function sessionKey($: EngineInterface): Promise<string | undefined> {
  const id =
    // The desktop app's own name for its row, unpromised: it outlives /clear and an archive. Unset (the terminal, another app), the next line serves.
    (await orNothing(() => $.env.get('CLAUDE_CODE_HOST_SESSION_ID'))) ||
    (await orNothing(() => $.session.id()))

  return id === undefined || id === '' ? undefined : `${SESSION_PREFIX}${id}`
}

/** The choice stored under a session's key, or nothing: none was made, or its theme is no longer in the table. */
async function sessionChoice($: EngineInterface, key: string): Promise<SessionChoice | undefined> {
  const stored = await $.store.get(key)

  if (typeof stored !== 'object' || stored === null || !('theme' in stored)) {
    return undefined
  }

  const theme = stored.theme

  return theme === null || (typeof theme === 'string' && themeOf(theme) !== undefined) ? { theme } : undefined
}

/**
 * Stores a session's own choice. The key is taken out first, so that the store's order is the order of the last
 * writes and the cap drops the session that chose longest ago. Those are two writes: where the second fails, what
 * stood is put back as far as the store lets it, so that a choice that was not applied does not cost the earlier one.
 * The cap is housekeeping: its fault costs the choice nothing.
 */
async function keepForSession($: EngineInterface, key: string, id: string | undefined): Promise<void> {
  const kept: SessionChoice = { theme: id ?? null }
  const stood = await $.store.get(key)

  await $.store.delete(key)

  try {
    await $.store.set(key, kept)
  } catch (error) {
    if (stood !== undefined) {
      try {
        await $.store.set(key, stood)
      } catch {
        // The first fault is the one to tell.
      }
    }

    throw error
  }

  try {
    const keys = (await $.store.keys()).filter(name => name.startsWith(SESSION_PREFIX))

    for (const oldest of keys.slice(0, Math.max(0, keys.length - SESSIONS_KEPT))) {
      await $.store.delete(oldest)
    }
  } catch {
    // The next choice tries again.
  }
}

/**
 * THE ONE WAY this mod changes which theme stands behind the chat: nothing else calls `show`.
 * It asks the engine for a theme (or none) and only then keeps the choice: `keep` writes the store or the state.
 * A set the engine refuses throws here with nothing written and what stood still shown. Where `keep` fails, the
 * window is put back to what stood, so that what a person sees and what they are told agree, and that first
 * fault is thrown on, whatever the put-back comes to. Each caller words its own plain sentence from the fault.
 * It answers what the set came to: a set the engine takes may be drawn by no surface, and the choice is kept all the
 * same (the engine hands what stands to a client that joins the session later and draws backdrops). A caller with a
 * person to tell says so; one that runs unasked stays quiet.
 */
async function showThenKeep(
  $: EngineInterface,
  id: string | undefined,
  keep?: () => Promise<unknown>,
): Promise<BackdropAnswer | undefined> {
  const stood = await read($, choice)
  const set = await show($, id)

  try {
    await keep?.()
  } catch (error) {
    try {
      await show($, stood.preview ?? stood.applied)
    } catch {
      // The first fault is the one to tell.
    }

    throw error
  }

  return set
}

/**
 * Applies a theme (or none) to this session, and with `forAll` to every chat without a choice of its own.
 * A choice for this session alone is stored under the session's key; one for all chats takes that key away.
 */
async function apply(
  $: EngineInterface,
  id: string | undefined,
  forAll: boolean,
): Promise<BackdropAnswer | undefined> {
  return showThenKeep($, id, async () => {
    const own = await sessionKey($)

    // The session's key first: where that fails, nothing is written for all chats, and "could not be applied" is true.
    if (own !== undefined) {
      await (forAll ? $.store.delete(own) : keepForSession($, own, id))
    }

    if (forAll) {
      const keys = allChatsKeys()

      if (id === undefined) {
        for (const key of keys.clear) {
          await $.store.delete(key)
        }
      } else {
        await $.store.set(keys.write, id)
      }
    }

    // A new object: a preview that stood ends with the pick.
    await update($, choice, (): ThemeChoice => ({ applied: id, scope: forAll ? 'all' : 'session' }))
  })
}

/** A fault's own words. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs a step that must never cost a person their start or their prompt: its fault is told in one dim line of the
 * transcript, which is not sent to the model: the one sign a person gets. No toast: one at every turn would nag.
 */
async function quietly($: EngineInterface, step: () => Promise<void>): Promise<void> {
  try {
    await step()
  } catch (error) {
    try {
      await $.ui.log(`a step nobody waits on failed, and the window stays as it is (${reasonOf(error)})`)
    } catch {
      // An engine without that call, or one that refuses it: nothing more to tell.
    }
  }
}

/**
 * What is said where a theme is set that no surface draws. Only the choice for all chats is said to be saved: it is
 * always stored. A session's own is stored under the id of the moment, and with no id not at all. No place is promised.
 */
function unshownNote(isSaved: boolean): string {
  return isSaved ? KEPT_UNSHOWN : `${UNSHOWN}.`
}

/** What became of a pick: a fault's one plain sentence; or none, and whether a theme was set that no surface draws. */
type Picked = { fault: string } | { fault: undefined; isUnshown: boolean }

/**
 * Applies what a person picked, a theme or none, or says in one plain sentence why it could not: a scene that does
 * not build, a set the engine refuses, a store that fails, in the fault's own words. A person must read why, not the
 * engine's hint for authors. Nothing is kept then and the theme that stood stays.
 * A clear promises nothing to see, so it is never unshown.
 */
async function applyOrSay(
  $: EngineInterface,
  theme: Theme | undefined,
  forAll: boolean,
): Promise<Picked> {
  const fault = theme === undefined ? undefined : sceneFault(theme)

  if (theme !== undefined && fault !== undefined) {
    return { fault: `${theme.title} could not be drawn: ${fault}` }
  }

  try {
    const set = await apply($, theme?.id, forAll)

    return { fault: undefined, isUnshown: set?.isDrawn === false }
  } catch (error) {
    return {
      fault:
        theme === undefined
          ? `The theme could not be cleared: ${reasonOf(error)}`
          : `${theme.title} could not be applied: ${reasonOf(error)}`,
    }
  }
}

/** The stored choice for all chats: a theme's id, or none. The first key that holds one wins. */
async function allChatsChoice($: EngineInterface): Promise<string | undefined> {
  for (const key of allChatsKeys().toRead) {
    const stored = await $.store.get(key)

    if (typeof stored === 'string' && themeOf(stored) !== undefined) {
      return stored
    }
  }

  return undefined
}

/**
 * Brings a session to the choice it is due: at a start, and at each turn's start, so that a session open while
 * another one changed the choice for all chats takes the change at its next turn.
 * A session with a choice of its own in this process is left alone. A choice kept before the scope was is the
 * session's own where it differs from the one for all chats (it can only have come from this session), else that one.
 * A session whose own choice an earlier process stored takes that up again. Any other follows the choice for all chats.
 * ONE RULE FOR THE TWO IDS: the key of the moment is the only one read or written. Where this process holds the
 * session's own choice and the store holds nothing under that key (the app's id came late), the choice is written
 * there: the same process, so nothing is guessed. No choice is ever looked for under another key.
 */
async function followChoice($: EngineInterface): Promise<void> {
  const now = await read($, choice)
  const project = await allChatsChoice($)
  const isOwn = now.scope === 'session' || (now.scope === undefined && now.applied !== undefined && now.applied !== project)

  if (now.preview !== undefined || showEnding !== undefined) {
    return
  }

  const key = await sessionKey($)
  const kept = key === undefined ? undefined : await sessionChoice($, key)

  if (isOwn) {
    if (key !== undefined && kept === undefined) {
      await keepForSession($, key, now.applied)
    }

    return
  }

  if (kept !== undefined) {
    const own = kept.theme ?? undefined
    const take = (): Promise<unknown> =>
      update($, choice, (was): ThemeChoice => ({ ...was, applied: own, scope: 'session' }))

    // None chosen and none shown: the engine is asked nothing, or a clear would take another mod's theme away.
    await (own === undefined && now.applied === undefined ? take() : showThenKeep($, own, take))

    return
  }

  if (now.applied === project) {
    return
  }

  // Asked first: a theme the engine refuses is not taken as applied, and the next turn tries it again.
  await showThenKeep($, project, () =>
    update($, choice, (was): ThemeChoice => ({ ...was, applied: project, scope: 'all' })),
  )
}

/**
 * Ends a show: back to the theme the session shows, or to no backdrop where it has none.
 * The flag is let go only once the window is back, however that went: an ask that came while the end waited on the
 * engine would else start a show that this end then draws over.
 */
async function endFireworks($: EngineInterface): Promise<void> {
  try {
    const later = await read($, choice)

    await showThenKeep($, later.preview ?? later.applied)
  } finally {
    showEnding = undefined
  }
}

/**
 * Seven seconds of fireworks over the session's theme where it has one, else over a night sky of their own; SHADER_PARTING_MS longer over a theme with a shader.
 * ONE SHOW AT A TIME: a word or a command that comes while a show runs starts nothing and lengthens nothing, so
 * however often the word is said the window changes twice in a show's seconds and no oftener.
 * The flag is TAKEN IN THE SAME TICK AS IT IS TESTED, ahead of the first await: a command and a reply's block come on
 * their own clocks, and a second ask that came while the first waited on the engine would else pass the test too.
 * KNOWN: the timer's call stands outside the try. It throws only where the mod is already unloaded, and this load's
 * flag goes with the load. A wait that another mod's hook refuses is not thrown here, it is never run: the flag then
 * stays up, with no further show and no following of the project, until a reload.
 * A show that no surface says it draws runs its seconds all the same: a window may draw it without having said so.
 * The answer then bears one sentence more.
 */
async function fireworks($: EngineInterface): Promise<string> {
  if (showEnding !== undefined) {
    return 'Fireworks are already going.'
  }

  showEnding = 'starting'
  showCount += 1

  // The theme stays: a show is a sibling backdrop that draws the theme's scene with the bursts over it.
  const suffix = SHOW_SUFFIXES[showCount % SHOW_SUFFIXES.length] ?? SHOW_SUFFIXES[0]
  // The one setter beside showThenKeep: a show's backdrop is no theme of the table, its answer is told, and nothing is kept, so nothing is to put back.
  let set: BackdropAnswer
  let afterShader = false

  try {
    const now = await read($, choice)
    const theme = themeOf(now.preview ?? now.applied)

    afterShader = theme?.shader !== undefined

    // The theme's sound goes with its show: a set names the whole theme, and an ambience that is set again unchanged plays on.
    set = await setBackdrop(
      $,
      theme === undefined
        ? { id: NIGHT_ID, glass: NIGHT_GLASS }
        : backdropOf(theme, `${theme.id}${suffix}`),
    )
  } catch (error) {
    // A show that did not begin costs a reply nothing, and the next word may try again.
    showEnding = undefined

    return `Fireworks could not be shown: ${reasonOf(error)}`
  }

  showEnding = $.clock.after(afterShader ? SHOW_MS + SHADER_PARTING_MS : SHOW_MS, () => void quietly($, () => endFireworks($)))

  return set?.isDrawn === false ? `Fireworks. ${SHOW_UNSHOWN}` : 'Fireworks.'
}

/**
 * Whether a show may go off by itself on the word: yes, unless the person turned that off.
 * A store that cannot be read counts as off: on a doubt no picture comes unasked.
 */
async function goesOffByItself($: EngineInterface): Promise<boolean> {
  try {
    return (await $.store.get(AUTO_KEY)) !== 'off'
  } catch {
    return false
  }
}

/** `/fireworks` alone starts a show, whatever the key holds; `auto off` and `auto on` write the key. */
async function fireworksCommand($: EngineInterface, args: string): Promise<string> {
  const words = args.trim().toLowerCase().split(/\s+/).join(' ')

  if (words === '') {
    return fireworks($)
  }

  if (words !== 'auto off' && words !== 'auto on') {
    return 'Try /fireworks, /fireworks auto off or /fireworks auto on.'
  }

  try {
    await (words === 'auto off' ? $.store.set(AUTO_KEY, 'off') : $.store.delete(AUTO_KEY))
  } catch (error) {
    return `That could not be kept: ${reasonOf(error)}`
  }

  return words === 'auto off'
    ? 'Fireworks no longer go off by themselves. /fireworks still starts a show.'
    : 'Fireworks go off again when Claude says "merged".'
}

/** The elements the picker draws with: a desktop's, or a surface's without `Svg`, which draws the names alone. */
type PickerElements = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button'> & { Svg?: Elements['desktop']['Svg'] }

/** The picker's filters: every theme, the kind of window each is made for, the scenes that answer the pointer, the added ones. */
const FILTERS: readonly { key: PickerView['filter']; label: string; test: (theme: Theme) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'light', label: 'Light window', test: theme => theme.window === 'light' },
  { key: 'dark', label: 'Dark window', test: theme => theme.window === 'dark' },
  { key: 'pointer', label: 'Answers the pointer', test: theme => theme.shader !== undefined },
  { key: 'added', label: 'Added', test: theme => theme.origin === 'added' },
]

/**
 * One tile of the picker: a theme's preview and the button that applies it. Every theme has a tile of its own, the
 * night one of a pair too: its preview carries its own dark glass (tools/build-previews.mjs), so no two look alike.
 */
type Tile = { key: string; title: string; picture: Theme; themes: Theme[] }

/** The tiles a filter shows, the added themes first, so that a theme just brought in is at the top. */
function tilesFor(filter: PickerView['filter']): Tile[] {
  const test = FILTERS.find(one => one.key === filter)?.test ?? (() => true)
  const shown = THEMES.filter(test)
  const ordered = [...shown.filter(theme => theme.origin === 'added'), ...shown.filter(theme => theme.origin !== 'added')]

  return ordered.map(theme => ({ key: theme.id, title: theme.title, picture: theme, themes: [theme] }))
}

// Each picture's preview once read: the picker reads each at most once, then draws from here.
const previews = new Map<string, string>()
// Themes whose preview could not be had: not asked again until a rescan.
const noPreview = new Set<string>()

/** An added theme's preview, from its scene, already read: the scene at rest, at most 240 by 150, scaled to its slot. */
function previewFromScene(scene: string): string | undefined {
  // The scene's own size fills a window; the preview's is its own, so that the Svg takes it up to the slot's width.
  const preview = scene
    .replace(RESTING_RULE, '@media all')
    .replace(
      /<svg\b([^>]*)>/,
      (_whole, attributes: string) => `<svg${attributes.replace(/\s(?:width|height)="[^"]*"/g, '')} width="240" height="150">`,
    )

  return preview.length > 131_072 ? undefined : preview
}

/**
 * Has a theme's preview at hand. A built-in theme's is a small picture made ahead by tools/build-previews.mjs: the
 * scenes themselves, up to 115,000 characters each, are more than a pane takes in one draw.
 */
async function loadPreview($: EngineInterface, theme: Theme): Promise<void> {
  if (previews.has(theme.id) || noPreview.has(theme.id)) {
    return
  }

  try {
    // An added theme's own small preview where its folder has one, else one made from its scene.
    const preview =
      theme.origin === 'added'
        ? (theme.preview ?? previewFromScene(theme.scene()))
        : await $.fs.read(`${$.plugin.root}/previews/${theme.id}.svg`)

    if (preview === undefined) {
      noPreview.add(theme.id)
    } else {
      previews.set(theme.id, preview)
    }
  } catch {
    noPreview.add(theme.id)
  }
}

// The last scan of the added themes' folder: the picker says what it left out.
let lastScan: AddedReport | undefined

/** What a scan came to, in a sentence or two. */
function scanSaid(report: AddedReport): string {
  if (report.folder === undefined) {
    return 'No home folder was found, so no themes were added.'
  }

  const head = `${report.added} added theme${report.added === 1 ? '' : 's'} from ${report.folder}.`

  return report.skipped.length === 0 ? head : `${head} Left out: ${report.skipped.join('; ')}.`
}

/** Reads the added themes' folder again, and draws the picker again with what it found. */
async function rescan($: EngineInterface): Promise<string> {
  lastScan = await loadAddedThemes($)
  previews.clear()
  noPreview.clear()
  // A new count, so that the picker draws again even where the filter stays.
  await update($, view, was => ({ ...was, rev: was.rev + 1 }))

  return scanSaid(lastScan)
}

/** A pick on the picker: the theme (or none) applied where the picker says. The picker stays open for another pick. */
async function pickFromPicker($: EngineInterface, theme: Theme | undefined, forAll: boolean): Promise<void> {
  const picked = await applyOrSay($, theme, forAll)

  if (picked.fault !== undefined) {
    void $.ui.toast(picked.fault)

    return
  }

  if (picked.isUnshown) {
    void $.ui.toast(unshownNote(forAll))

    return
  }

  const where = forAll ? 'all chats' : 'this chat'

  void $.ui.toast(theme === undefined ? `Theme cleared for ${where}.` : `${theme.title} applied to ${where}.`)
}

/** Where a pick applies, kept for later sessions too: a store that fails costs only that. */
async function setScope($: EngineInterface, scope: PickerView['scope']): Promise<void> {
  await update($, view, was => ({ ...was, scope }))

  try {
    await $.store.set(SCOPE_KEY, scope)
  } catch {
    // The picker still shows the choice; the next session starts on This chat.
  }
}

async function setFilter($: EngineInterface, filter: PickerView['filter']): Promise<void> {
  await update($, view, was => ({ ...was, filter }))
}

/** Opens the picker beside the chat, in the app's own look. */
async function openPicker($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Themes', focus: true, closeOnEscape: true })
}

function rowsOf<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = []

  for (let at = 0; at < items.length; at += size) {
    rows.push(items.slice(at, at + size))
  }

  return rows
}

/**
 * The picker: where a pick applies, the filters and what this chat shows, then every tile of the filter four to a
 * row, the pane scrolling through them. Each tile is its preview with a button beneath for each of its themes: no
 * picture can sit inside a button, and the desktop draws a button's `label` alone, so the name is what a person
 * presses. A pair's buttons are its title (the light window's) and Night (the dark window's).
 */
function picker($: EngineInterface, { Box, Text, Button, Svg }: PickerElements, now: ThemeChoice, shown: PickerView) {
  const tiles = tilesFor(shown.filter)
  const rows = rowsOf(tiles, COLUMNS)
  const themeCount = tiles.reduce((sum, tile) => sum + tile.themes.length, 0)
  const applied = themeOf(now.applied)
  const forAll = shown.scope === 'all'
  const hasAdded = THEMES.some(theme => theme.origin === 'added')
  const showing =
    applied === undefined
      ? 'No theme shows in this chat.'
      : `This chat shows ${applied.title}, ${now.scope === 'session' ? 'its own choice' : 'the choice for all chats'}. Made for ${applied.window} windows.`
  const leftOut = lastScan === undefined || lastScan.skipped.length === 0 ? undefined : lastScan.skipped.join('; ')

  return (
    <Box flexDirection="column" gap="sm">
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="sm" rowGap="xs">
        <Text dimColor>Apply to</Text>
        <Button
          key="scope-session"
          label={forAll ? 'This chat' : '✓ This chat'}
          variant={forAll ? 'secondary' : 'primary'}
          onPress={() => setScope($, 'session')}
        />
        <Button
          key="scope-all"
          label={forAll ? '✓ All chats' : 'All chats'}
          variant={forAll ? 'primary' : 'secondary'}
          onPress={() => setScope($, 'all')}
        />
        <Button key="none" label="No theme" onPress={() => pickFromPicker($, undefined, forAll)} />
        <Button key="close" label="Close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap="xs" rowGap="xs">
        {FILTERS.filter(one => one.key !== 'added' || hasAdded).map(one => (
          <Button
            key={`filter-${one.key}`}
            label={`${one.label} ${tilesFor(one.key).length}`}
            variant={shown.filter === one.key ? 'primary' : 'secondary'}
            onPress={() => setFilter($, one.key)}
          />
        ))}
      </Box>
      <Text dimColor>{showing}</Text>
      {rows.map((row, rowAt) => (
        <Box key={`row-${shown.filter}-${rowAt}`} flexDirection="row" flexWrap="nowrap" columnGap="xs">
          {row.map(tile => {
            const preview = Svg === undefined ? undefined : previews.get(tile.picture.id)

            return (
              // A quarter less the gaps, and free to shrink below its picture's own width: four always fit across.
              <Box key={`tile-${tile.key}`} width="24%" minWidth={0} flexShrink={1} flexDirection="column" gap="xs">
                {preview === undefined || Svg === undefined ? [] : <Svg alt={`${tile.title}: ${tile.picture.blurb}`} source={preview} />}
                <Box flexDirection="row" flexWrap="wrap" gap="xs">
                  {tile.themes.map(theme => {
                    const word = theme.title
                    const isShown = now.applied === theme.id

                    return (
                      <Button
                        key={`pick-${theme.id}`}
                        label={isShown ? `✓ ${word}` : word}
                        variant={isShown ? 'primary' : 'secondary'}
                        onPress={() => pickFromPicker($, theme, forAll)}
                      />
                    )
                  })}
                </Box>
              </Box>
            )
          })}
        </Box>
      ))}
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="sm" rowGap="xs">
        <Text dimColor>{`${tiles.length} pictures, ${themeCount} themes.`}</Text>
        <Button
          key="rescan"
          label="Rescan added themes"
          dimColor
          onPress={async () => {
            void $.ui.toast(await rescan($))
          }}
        />
      </Box>
      {leftOut === undefined ? [] : <Text dimColor>{`Left out of the added themes: ${leftOut}`}</Text>}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A refused name must not cost the session its backdrop: go on without the command.
    try {
      await $.command.register({
        name: COMMAND,
        description:
          'Open the theme picker. Or add a name to apply it to all chats ("chat" after it: this chat only), "list" to see all, "off" to clear.',
      })
    } catch (error) {
      void $.ui.toast(`theme-picker: /${COMMAND} is not available (${String(error)})`)
    }

    // A name no other plugin answers: while theme-examples also answers /custom-theme, this one is the picker's alone.
    try {
      await $.command.register({ name: OWN_COMMAND, description: 'Open the theme picker beside the chat.' })
    } catch (error) {
      void $.ui.toast(`theme-picker: /${OWN_COMMAND} is not available (${String(error)})`)
    }

    try {
      await $.command.register({
        name: FIREWORKS_COMMAND,
        description: 'Set off fireworks. Add "auto off" to stop the automatic ones, "auto on" to resume.',
      })
    } catch (error) {
      void $.ui.toast(`theme-picker: /${FIREWORKS_COMMAND} is not available (${String(error)})`)
    }

    // The added themes first: a stored choice may name one of them.
    await quietly($, async () => {
      lastScan = await loadAddedThemes($)
    })

    // Where a pick applies, as the person left it in an earlier session.
    await quietly($, async () => {
      const kept = await $.store.get(SCOPE_KEY)

      if (kept === 'session' || kept === 'all') {
        const scope: PickerView['scope'] = kept === 'all' ? 'all' : 'session'

        await update($, view, was => ({ ...was, scope }))
      }
    })

    // A preview left in the state has no clock in this load (the module's own variables start over): its end
    // never ran. Drop it, or this session would never follow the choice for all chats again.
    if ((await read($, choice)).preview !== undefined) {
      await update($, choice, was => ({ ...was, preview: undefined }))
    }

    // A session's own choice outlives a reload and a new process; any other follows the one for all chats.
    // Two steps, each quiet by itself: a choice that cannot be followed must not cost the window what the state holds.
    await quietly($, () => followChoice($))
    await quietly($, async () => {
      const shown = (await read($, choice)).applied

      if (themeOf(shown) !== undefined) {
        await showThenKeep($, shown)
      }
    })

    return next(e)
  })

  // A turn's start: an open session takes a change another session made to the choice for all chats. It always
  // passes on: a fault of its own must never cost the person their prompt.
  on('prompt.submit', async ($, e, next) => {
    await quietly($, () => followChoice($))

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(word => word !== '')
    const last = words.at(-1)?.toLowerCase()
    // A scope word is the last of two or more words: "chat" or "session" for this chat alone, "all" for every chat.
    const isScoped = words.length > 1 && (last === 'chat' || last === 'session' || last === 'all')
    const forAll = !(isScoped && last !== 'all')
    const name = (isScoped ? words.slice(0, -1) : words).join(' ')
    const key = keyOf(name)

    if (name === '') {
      await openPicker($)

      return { text: 'Theme picker opened beside the chat.' }
    }

    if (key === 'list') {
      return { text: themeList() }
    }

    if (key === 'rescan') {
      return { text: await rescan($) }
    }

    if (key === 'off') {
      const cleared = await applyOrSay($, undefined, forAll)

      if (cleared.fault !== undefined) {
        return { text: cleared.fault }
      }

      return {
        text: forAll
          ? 'Theme cleared for all chats. Other open chats without a choice of their own clear at their next turn.'
          : 'Theme cleared for this chat only. Other chats keep theirs.',
      }
    }

    const theme = themeNamed(name)

    if (theme === undefined) {
      // One line: the reason stays in view. Nothing is applied and nothing is stored.
      const nearest = nearestTheme(name)

      return {
        text:
          `No theme named "${name}". ` +
          (nearest === undefined ? '' : `The nearest is ${nearest.id}. `) +
          `/${COMMAND} list names all ${THEMES.length}; "chat" as the last word is this chat only.`,
      }
    }

    const picked = await applyOrSay($, theme, forAll)

    if (picked.fault !== undefined) {
      return { text: picked.fault }
    }

    // A mod cannot learn which kind the window is, so every answer says which kind the theme is made for, and names its twin as the list does.
    const twin = themeOf(theme.twin)
    const said =
      (forAll
        ? `${theme.title} applied to all chats. Other open chats without a choice of their own take it at their next turn.`
        : `${theme.title} applied to this chat only.`) +
      ` Made for ${theme.window} windows${twin === undefined ? '' : ` (for ${twin.window} windows: ${twin.id})`}.`

    return { text: picked.isUnshown ? `${said} ${unshownNote(forAll)}` : said }
  })

  on('command.run', { command: OWN_COMMAND }, async $ => {
    await openPicker($)

    return { text: 'Theme picker opened beside the chat.' }
  })

  // The quiz-pane toolbar's Themes button. A pane is drawn only by the plugin that opened it, so the
  // picker opens here, on hearing the press: at once, mid-reply too, where a slash command another
  // plugin runs would wait for the turn to end. A second press closes the picker when it is the pane
  // shown; one open behind another pane's tab is brought to the front instead (closed and opened
  // again, since re-opening an open id only retitles it).
  on('ui.press', { plugin: 'quiz-pane', component: 'AbovePrompt', element: 'tb-themes' }, async ($, e, next) => {
    try {
      const row = (await $.ui.panes()).find(pane => pane.id === PANE)
      if (row?.isShown) {
        await $.ui.close({ id: PANE })
      } else {
        if (row !== undefined) await $.ui.close({ id: PANE })
        await openPicker($)
      }
    } catch (error) {
      $.ui.log(`theme-picker: the toolbar's Themes press: ${String(error)}`, { to: 'debug' })
    }

    return next(e)
  })

  // One panel at a time: whenever quiz-pane opens one of its panels (its toolbar, a quiz the model
  // loads, /quiz), the picker closes. quiz-pane does the same the other way round when the picker opens.
  on('ui.open', { id: ['quiz', 'quiz-agents', 'quiz-side'] }, async ($, e, next) => {
    const opened = await next(e)
    try {
      if ((await $.ui.panes()).some(pane => pane.id === PANE)) await $.ui.close({ id: PANE })
    } catch (error) {
      $.ui.log(`theme-picker: closing the picker for quiz-pane's panel: ${String(error)}`, { to: 'debug' })
    }

    return opened
  })

  on('command.run', { command: FIREWORKS_COMMAND }, async ($, e) => ({ text: await fireworksCommand($, e.args) }))

  // Every block of the model's reply comes through here once, as text, before it is stored.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    const said = e.message.content.some(
      block => block.type === 'text' && typeof block.text === 'string' && WORD.test(block.text),
    )

    if (said && (await goesOffByItself($))) {
      await fireworks($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    // Only a window has room behind the chat, and only its table has `Svg`.
    if (e.props.plugin !== PLUGIN || e.surface !== 'desktop') {
      return next(e)
    }

    const name = sceneNameOf(e.props)

    if (name === undefined) {
      return next(e)
    }

    const { Svg, Shader } = $.ui.resolve(e)

    if (name === NIGHT_ID) {
      return <Svg isInteractive alt="Fireworks bursting over a night sky" source={nightScene()} />
    }

    const showOf = themeOf(themeIdOfShow(name))

    if (showOf !== undefined) {
      return (
        <Svg
          isInteractive
          alt={`Fireworks over ${showOf.title}`}
          source={sceneWithFireworks(showOf, sceneOf(showOf))}
        />
      )
    }

    const theme = themeOf(name)

    if (theme === undefined) {
      return next(e)
    }

    return overShader(
      Shader,
      theme.shader,
      <Svg isInteractive alt={`${theme.title}: ${theme.blurb}`} source={sceneOf(theme)} />,
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const now = await read($, choice)
    const shown = await read($, view)

    if (e.surface === 'desktop' || e.surface === 'mobile') {
      const { Box, Text, Button, Svg } = $.ui.resolve(e)

      // Minimized to a widget: a glance, since a click may not reach it.
      if (e.props.placement === 'widget') {
        return <Text>{themeOf(now.applied)?.title ?? 'No theme'}</Text>
      }

      // The filter's previews read first, each once: the draw itself then only lays them out.
      await Promise.all(tilesFor(shown.filter).map(tile => loadPreview($, tile.picture)))

      return picker($, { Box, Text, Button, Svg }, now, shown)
    }

    // A surface without Svg (the terminal, an editor) draws the names alone.
    const { Box, Text, Button } = $.ui.resolve(e)

    return picker($, { Box, Text, Button }, now, shown)
  }).catch(($, e, next) => {
    // A picker that could not draw says why, in place of a blank pane.
    const { Text } = $.ui.resolve(e)
    const why = next.error?.kind === 'timeout' ? 'it ran out of time' : (next.error?.message ?? 'an unknown fault')

    return <Text>{`The theme picker could not draw: ${why}. Try /custom-theme again.`}</Text>
  })
}
