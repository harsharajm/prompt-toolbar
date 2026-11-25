# Prompt toolbar

A toolbar above the prompt in the Claude desktop app, with five buttons. It is two plugins, installed together:

- **quiz-pane**: the toolbar itself, and the quiz pane.
- **theme-picker**: the still backdrops the Themes button opens.

## The buttons

| Button | What it does |
| --- | --- |
| Agents | A panel with one line per subagent: what it is doing right now, plus its model, effort, time, tokens and cost. Each agent gets a small pixel crab dressed for its current action (reading, writing, searching, running a command, browsing, waiting, ...); the four newest running crabs walk, the rest stand still to save CPU. Finished agents stay until you clear them. |
| Quiz | Opens the quiz pane. Ask Claude to quiz you on something and it loads the questions there: pick an option or type an answer. `/quiz` opens it too. |
| Compact | Compacts the chat after you confirm. Once the chat passes half its context window (or 120k tokens), the button shows how full it is, for example `Compact 65%`. If Claude is busy, the compact runs as soon as it is idle. |
| Side chat | A pane for quick questions about the chat. Claude answers from the conversation so far without adding anything to the main chat. |
| Themes | Opens the theme picker: 38 still backdrops for behind the chat, for this chat or for all chats. `/custom-theme` and `/themes` open it too. |

One pane at a time: opening one closes the others.

## Install

Made for the Claude desktop app, on Claude Code 2.1.330 or newer (the version it was built and tested on). The install commands work from older command lines too.

1. In a terminal, run:

   ```
   claude plugin marketplace add https://github.com/harsharajm/prompt-toolbar.git
   claude plugin install quiz-pane@prompt-toolbar
   claude plugin install theme-picker@prompt-toolbar
   ```

2. Open a new chat in the desktop app, or type `/reload-plugins` in an open one.

If the terminal does not recognise `claude`, install the Claude Code command line first.

### From a copy of this folder

For a zip you were sent, or **Code → Download ZIP** on GitHub:

1. Unzip it somewhere you will keep it. Claude Code installs the plugins from that folder.
2. In a terminal, run these, with the path of the folder that holds this README:

   ```
   claude plugin marketplace add "C:\path\to\prompt-toolbar"
   claude plugin install quiz-pane@prompt-toolbar
   claude plugin install theme-picker@prompt-toolbar
   ```

3. Open a new chat in the desktop app, or type `/reload-plugins` in an open one.

## Good to know

- **theme-examples**: if Anthropic's theme-examples plugin is on, turn it off. Both answer `/custom-theme` and both set the backdrop.
- **savvy-progress**: if it is on, its once-a-second clock makes the toolbar buttons flicker under the pointer. Turning it off stops the flicker.
- **Still backdrops**: theme-picker draws every backdrop as a still picture, with no animation, shaders or fireworks: measured on a Windows desktop, a moving one kept about one CPU core busy. While Claude is working or the chat scrolls, a backdrop still costs some CPU; **No theme** costs least. See `plugins/theme-picker/README.md`.
- **Your own themes**: theme-picker can add themes from a folder. See `plugins/theme-picker/README.md`.
- **Terminal**: the crabs are pictures, so they show only in the desktop app.

## Update

In the desktop app, in one step: type `/plugin`, open **Marketplaces**, pick **prompt-toolbar** and choose **Update marketplace**. That updates both plugins together. The same tab can turn on auto-update for prompt-toolbar, which is off by default for marketplaces other than Anthropic's.

Or in a terminal:

```
claude plugin marketplace update prompt-toolbar
claude plugin update quiz-pane@prompt-toolbar
claude plugin update theme-picker@prompt-toolbar
```

The first command refreshes Claude Code's copy of this repository, and `claude plugin update` takes one plugin at a time, so there is one line for each.

Either way, open a new chat in the desktop app, or type `/reload-plugins` in an open one, to load the new versions.

## Uninstall

```
claude plugin uninstall quiz-pane@prompt-toolbar
claude plugin uninstall theme-picker@prompt-toolbar
claude plugin marketplace remove prompt-toolbar
```

## Credits and licences

- The toolbar's own code is under the MIT License in `LICENSE`.
- theme-picker is a fork of Anthropic's theme-examples 0.6.0 and stays under the Apache License 2.0. See `plugins/theme-picker/LICENSE`, and its README for what the fork changes.
- The Agents panel's crabs are adapted from savvy-progress by johnnyvizz, under the MIT License. The notice is at the top of `plugins/quiz-pane/hooks/crabs.ts`.
