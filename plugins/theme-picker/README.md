# Theme picker

Still backdrops behind the chat in the Claude desktop app, picked from a grid of previews.

A fork of Anthropic's `theme-examples` 0.6.0 (Apache License 2.0, see LICENSE). Its 38 scenes and sounds are kept; its
shaders and fireworks are gone. What this fork changes:

- **Every backdrop is still.** Each theme is drawn as its picture at rest (the scene's own `prefers-reduced-motion`
  picture), as a plain image, with nothing over it: no shader, no CSS motion, no fireworks, and no switch to turn motion
  on. Measured on a Windows desktop with the window in front, Claude kept about one CPU core busy with a moving theme
  in view, and used about 0.1% of the CPU with a still one and nothing else on screen moving.
- `/custom-theme` opens a picker pane beside the chat: previews four to a row, the pane scrolling through them, each
  with its name beneath as the button that applies it. Filters for light windows, dark windows and added themes. The
  card of theme-examples is gone.
- A pick applies to **This chat** or to **All chats**, chosen at the top of the picker and remembered. A chat's own
  choice stands over the one for all chats. theme-examples kept one choice per project; this fork keeps one for every
  chat instead.
- Themes can be added from a folder (below), so themes from elsewhere can join the built-in ones.
- The **Themes** button on the quiz-pane toolbar opens the picker and closes it again, and the picker steps aside when
  one of that toolbar's own panes opens.

A still backdrop is not free while something else on screen moves. In the same measurement, with a running task's
indicator moving, Claude used about one core with a still theme and about an eighth of a core with **No theme**: the
app frosts its panels over a backdrop and seems to draw that glass again whenever anything moves. So while Claude is
working, or the chat scrolls, a backdrop still costs CPU; **No theme** costs least.

Turn theme-examples off while this is on: both answer `/custom-theme`, and both set the backdrop.

## Commands

- `/custom-theme` opens the picker; so does `/themes`.
- `/custom-theme <name>` applies a theme to all chats; `/custom-theme <name> chat` to this chat only.
- `/custom-theme off` clears the theme for all chats; `/custom-theme off chat` for this chat only.
- `/custom-theme list` names every theme. `/custom-theme rescan` reads the added themes' folder again.
- The command words `list`, `rescan` and `off` come before theme names: an added theme named one of them is applied
  from the picker instead.

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

- one `<svg>` document of at most 131,072 characters once held still (holding it still adds up to 80 characters), with
  a `viewBox` and `preserveAspectRatio="xMidYMid slice"`;
- vector shapes only: no `<image>` (no embedded pictures), no scripts, no `foreignObject`;
- drawn still: the backdrop and the picker's preview show the scene's resting picture, under
  `@media (prefers-reduced-motion: reduce)` in its own `<style>`, and any CSS animation or transition left after it is
  stopped where it stands. A scene that moves by SMIL (`<animate>` and the like), which no style can stop, is left out;
  a folder's own `preview.svg` that does gives way to a preview made from the scene.

A theme the picker cannot use is left out, and the picker says why at its foot.
