# Theme picker

Backdrops behind the chat in the Claude desktop app, picked from a grid of previews.

A fork of Anthropic's `theme-examples` 0.6.0 (Apache License 2.0, see LICENSE). Its 38 scenes, sounds, shaders and
fireworks are unchanged. What this fork changes:

- `/custom-theme` opens a picker pane beside the chat: four rows of four previews a page, each with its name beneath
  as the button that applies it. Filters for light windows, dark windows, scenes that answer the pointer and added
  themes. The card of theme-examples is gone.
- A pick applies to **This chat** or to **All chats**, chosen at the top of the picker and remembered. A chat's own
  choice stands over the one for all chats. theme-examples kept one choice per project; this fork keeps one for every
  chat instead.
- Themes can be added from a folder (below), so themes from elsewhere can join the built-in ones.
- The **Themes** button on the quiz-pane toolbar opens the picker and closes it again, and the picker steps aside when
  one of that toolbar's own panes opens.

Turn theme-examples off while this is on: both answer `/custom-theme`, and both set the backdrop.

## Commands

- `/custom-theme` opens the picker; so does `/themes`.
- `/custom-theme <name>` applies a theme to all chats; `/custom-theme <name> chat` to this chat only.
- `/custom-theme off` clears the theme for all chats; `/custom-theme off chat` for this chat only.
- `/custom-theme list` names every theme. `/custom-theme rescan` reads the added themes' folder again.
- `/fireworks`, `/fireworks auto off`, `/fireworks auto on`: as in theme-examples.

## Added themes

Each added theme is a folder under `~/.claude/theme-picker/themes/` (on Windows `%USERPROFILE%\.claude\theme-picker\themes\`):

```
themes/
  my-theme/
    theme.json
    scene.svg
```

`theme.json`:

```json
{
  "title": "My Theme",
  "blurb": "One line about what the scene shows.",
  "window": "dark",
  "glass": { "blur": 14, "tint": "#101418", "opacity": 0.45 },
  "scene": "scene.svg",
  "twin": "my-theme-light",
  "source": "https://github.com/owner/repo"
}
```

Only `title` matters; the rest have defaults (`window` dark, `scene` scene.svg, a plain glass). The folder's name is the
theme's id unless `id` is given. The picker reads the folder when a session starts, and again on **Rescan added themes**.

The scene is what the desktop app draws behind the chat, so it is held to the app's rules for a backdrop:

- one `<svg>` document of at most 131,072 characters, with a `viewBox` and `preserveAspectRatio="xMidYMid slice"`;
- vector shapes only: no `<image>` (no embedded pictures), no scripts, no `foreignObject`;
- motion as CSS animation inside its own `<style>`, slow, with a resting picture under
  `@media (prefers-reduced-motion: reduce)`: the picker's preview shows that resting picture.

A theme the picker cannot use is left out, and the picker says why at its foot.
