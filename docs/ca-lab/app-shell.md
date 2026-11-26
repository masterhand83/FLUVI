# Native app shell

`ca-app` exports `shell::Shell`. It owns translations, preferences, sidebar,
notifications, and dialogs. It does not own simulation state. Later features
receive `&mut Shell` from the app rather than creating another shell.

## Feature API

- `tr(key, &[("name", value)])` translates a catalog key. Values stay plain text.
  Use `count` for plurals. Spanish is the fallback. Unknown keys display as keys.
- `notify(Severity::Success, message)` displays a plain-text toast for eight
  seconds. Error, warning, and info use the same API and localized severity titles.
  The queue holds at most eight notices; a new notice removes the oldest.
- `confirm(title, message)` returns a bounded receiver. Poll `try_recv()` from
  the feature update loop; never wait on the UI thread. Confirm returns `true`;
  Cancel, Escape, and backdrop clicks return `false`. At most eight requests
  are queued; additional requests return `false` immediately.
- `preferences()` reads current preferences. Clone, modify, and pass them to
  `set_preferences()` to save. Save errors keep the old preferences and produce
  a localized error toast.

Only catalog keys are translated. Stored identifiers such as `generador` and
`lineal`, user names, filenames, and export payloads must stay data.
Parameter expansion does not interpret placeholders inside parameter values.

## Preferences

The JSON file is `fluvi/preferences.json` below:

- Linux: absolute `$XDG_CONFIG_HOME`, or `$HOME/.config`.
- macOS: `$HOME/Library/Application Support`.
- Windows: `%APPDATA%`.

Fields are `language` (`es` or `en`), `sidebar_visible`, `panels_open`
(seven booleans in sidebar order), `cell_detection`, `dark_mode`, and
`export_quality` (`performance`, `balance`, `quality`, or `ultraquality`).
Defaults are Spanish, visible sidebar, only About open, cell detection off,
light mode, and Balance export quality. Missing values use defaults. Invalid fields use defaults
independently and produce a warning. Invalid JSON uses all defaults and warns.
A missing file is a normal first start. Saves write a neighboring temporary
file before replacing the old file.

The translator is fixed when the shell starts. Changing the language saves
the next-start preference and shows a notice in the current language. It does
not change active text, play/pause, speed, step requests, or traffic state.
Cell detection controls map-cell hover text. It does not disable cell clicks.
Advanced settings opens a modal with a Graphics section. Export quality saves
immediately and controls metric PNG resolution/sampling and the separate heatmap
preview. It does not change the main simulation map.

## Startup and verification

The native framework creates the graphics adapter before the first UI frame.
The app then displays localized resource and graphics-engine progress while
a worker creates the traffic scene and its GPU display resources. A bounded
channel transfers ownership to the UI thread without waiting. The loading view
does not claim to report progress inside the framework's adapter request.

`cargo test -p ca-app shell::tests` checks catalog parity, placeholders, plural
forms, restart behavior, invalid files, literal names, and headless sidebar
and confirmation clicks. `cargo smoke` checks the shell with the real traffic
GPU callback and native window.
