export type ThemeChoice = {
  /** The theme this session shows, by its own choice or the one for all chats; absent, none. */
  applied?: string
  /**
   * Whose choice `applied` is: this chat's own, or the one for all chats. A chat's own choice stays at every later
   * start; any other follows the choice for all chats. Absent in a choice kept before this was.
   */
  scope?: 'session' | 'all'
  /** A theme shown for a look only, until it is applied or the look ends. */
  preview?: string
}

/** What the picker pane shows: its filter, where a pick on it applies, and a count a rescan raises to draw it again. */
export type PickerView = {
  filter: 'all' | 'light' | 'dark' | 'pointer' | 'added'
  scope: 'session' | 'all'
  rev: number
}

declare module 'claude-code' {
  interface PluginState {
    'theme-picker': { choice: Shaped<ThemeChoice>; view: Shaped<PickerView> }
  }
}
