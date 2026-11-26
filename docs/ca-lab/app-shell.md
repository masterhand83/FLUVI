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
(seven booleans in sidebar order), `cell_detection`, `dark_mode`, `theme`,
`ui_font`, `label_font`, and
`export_quality` (`performance`, `balance`, `quality`, or `ultraquality`).
Defaults are Spanish, visible sidebar, only About open, cell detection off,
light mode, bundled fonts, and Balance export quality. Missing values use defaults. Invalid fields use defaults
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

## UI themes

Customization → Theme selects Default, Monokai, Gruvbox, Retro, Nord, Dracula,
or Rosé Pine. Selection saves immediately and applies before frame widgets.
Themes affect UI panels, dialogs, controls, and chart surfaces, not simulation
colors, map backgrounds, or exported images. The old light/dark switch applies
only to Default. Older preferences without `theme` keep their light/dark choice.

Each built-in is a self-contained JSON file in `crates/ca-app/src/themes/`,
embedded in the executable. Custom themes use the same format and need no Rust
code, external assets, or changes to the built-in registry.

1. Select a theme and use **Save theme as (JSON)**.
2. Edit the saved copy's `id`, `name`, `base`, and `colors`.
3. Use **Import theme (JSON)**. The app validates and copies it into a `themes/`
   folder beside `preferences.json`, selects it, and saves the selection.

Files in that folder also load on startup. Use a unique `id`; built-ins and
installed themes cannot be overwritten by an import. Export suggests a
`custom-` id. Give each further copy another id. Remove a custom file and restart
to remove it from the dropdown. Missing selected themes fall back to Default
with a warning. Invalid files are skipped without blocking valid themes.
Native exchange dialogs and file reads/writes run on one bounded worker job.

The version 1 format is:

```json
{
  "version": 1,
  "id": "my-theme",
  "name": "My Theme",
  "base": "dark",
  "colors": {
    "background": "#191724",
    "surface": "#1F1D2E",
    "input": "#151320",
    "text": "#E0DEF4",
    "accent": "#C4A7E7"
  }
}
```

`id` uses 1–64 lowercase ASCII letters, digits, or hyphens. `name` has 1–80
characters without control characters. `base` is `light` or `dark`.
All color overrides are optional; omitted roles use the egui base palette.
Colors must be opaque `#RRGGBB`. Available roles are `background`, `surface`,
`input`, `text`, `muted`, `border`, `widget`, `hover`, `active`, `accent`,
`selection`, `selection-text`, `warning`, and `error`. Unknown color roles,
invalid colors, unsupported versions, and files over 64 KiB are rejected.
Theme files contain data only and cannot execute code.

## System fonts

Customization → Fonts has separate searchable selectors for the UI and map
labels. Each selector lists installed system font families. An empty preference
selects Bundled default. Choices apply without a restart and are saved in native
preferences, not map JSON or theme files. The label choice affects street and
building names; the UI choice affects proportional interface text. Code examples
retain the bundled monospace font.

`shell::fonts` scans system fonts once on a worker through `fontdb`, including
the platform's user font directories and Linux Fontconfig configuration. It reads
only selected faces and retains collection indices. A bounded, non-blocking reply
keeps file access outside the UI thread. Newer choices discard stale results.
Selected fonts precede bundled glyph fallbacks. Missing or unreadable choices
produce a translated warning and use the bundled default. The saved name remains
available for a later restart after the font is installed again.

Font definitions update only after a selection changes or a new UI context starts.
Map labels use an independent named egui family, with no change to their pixel
size, geometry, zoom behavior, or simulation state.

Focused checks: `cargo test -p ca-app --lib shell::fonts`, and
`cargo test -p ca-app --test fonts --test map_labels --test control_panel`.

## UI icons

Use `ca-app::icons::{Icon, button, section_button, heading, checkbox}` for UI
icons. The main icon source is `icondata_ri` (Remix Icon). Add new semantic
variants to `Icon` rather than embedding emoji or private-use font characters
in labels. Translation catalogs contain text only.

The adapter rasterizes trusted bundled SVG paths to transparent white masks.
Each egui context retains its own texture cache. Images use the active text
color, including button hover and disabled states, without a texture rebuild
when the theme changes. No system icon font or runtime asset folder is needed.

The square before some old section icons was a missing-font-glyph marker.
The old expand arrow (`U+25BC`), emoji variation selector (`U+FE0F`), and crane
emoji had no glyph in the bundled fonts. Image icons remove that dependency.
`cargo test -p ca-app --lib sidebar_and_help_do_not_render_missing_glyphs`
checks rendered sidebar/help text in both languages. `cargo test -p ca-app
--test icons` checks icon alpha masks, texture reuse, and theme tint.

## Full information and guide

About → View Full Information and View Full Guide open scrollable offline
dialogs in the session language. Close, Escape, or a backdrop click dismisses
them. The close button stays outside the scrolling content.

`shell/help.rs` renders the embedded `shell/help/{es,en}.json` documents.
Run `python3 scripts/extract-v1-help.py` to copy both modal bodies from
`apps/v1/index.html`, using the v1 translation catalogs. The copy retains the
sections, Rule 184 table, JSON example, and credits. Emoji decorations are
removed so the text needs no system emoji font.

This is a copy of the v1 text, not a revised v2 manual. References to browser
libraries, old editing controls, and browser processing times remain as in v1.
Focused checks: `cargo test -p ca-app --lib shell::` and
`python3 -m unittest discover -s scripts -p test_extract_v1_help.py`.

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
