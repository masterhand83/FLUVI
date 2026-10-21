# v1 localization ownership and startup contract

This document is the navigation reference for the Spanish/English interface. The
feature ticket is `.scratch/v1-english-localization/issues/02-startup-language-and-simulator-controls.md`.
The first slice covers language selection, loading, sidebar headings, simulation
controls, a minimal street inspector, and notification plumbing. Later tickets
own the remaining workflows.

## Ownership

| Concern | Owner |
| --- | --- |
| Shared translation interface, preference, DOM integration | `src/js/ui/i18n.js` |
| Repository-owned Spanish/English catalogs | `src/locales/{es,en}/translation.json` |
| Browser-ready catalog bundle (generated) | `src/locales/catalogs.js` |
| Pinned browser dependency | `src/libs/i18next/i18next.min.js`, `src/libs/i18next/VERSION` |
| Catalog generation and validation | `scripts/build-locales.mjs`, `scripts/validate-locales.mjs` |
| Extraction/status configuration | `i18next.config.ts` |
| Notification severity and confirmation defaults | `src/js/ui/notifications.js` |
| Language selector and settings notice | `index.html` (`#languagePreference`, `#languagePreferenceNotice`) |

Do not add a hosted translation service, backend endpoint, or runtime API key.
Catalogs and the i18next UMD build are copied by `scripts/build-static.mjs` with
the rest of `src/`.

## Startup load order

`index.html` loads localization in the document head, after `darkMode.js` and
before body markup and every application script:

1. `src/libs/i18next/i18next.min.js`
2. `src/locales/catalogs.js`
3. `src/js/ui/i18n.js`

`i18n.js` reads the saved preference synchronously, falls back to Spanish for an
absent or invalid value, initializes i18next with `initAsync: false`, and sets
`<html lang>` before user-facing content is evaluated. It translates static DOM
nodes on `DOMContentLoaded` and again when `fluviI18n.translateDocument()` is
called. Keep this order: classic scripts such as `loadingSystem.js` call `tr()`
while they are evaluated, and Bootstrap tooltips read translated
`data-bs-title` values when they initialize.

Application script order and public simulation globals (`window.calles`,
`window.conexiones`, `window.isPaused`, and the rest) are unchanged.

## Public interface

`window.fluviI18n` is the shared interface. `window.tr(key, options)` is the
short form used by application code.

| Member | Purpose |
| --- | --- |
| `t(key, options)` / `tr(key, options)` | Translate with named interpolation and `count` plurals. |
| `tEscaped(key, options)` | Translate for an HTML-rendering path; interpolation values are escaped. |
| `translateDocument(root?)` / `translateElement(element)` | Apply `data-i18n` and `data-i18n-attr` annotations. |
| `setText(element, key, options)` | Replace direct text while preserving child elements. |
| `setAttribute(element, attribute, key, options)` | Set a translated attribute, including `data-bs-title`. |
| `refreshTooltip(element)` | Update an initialized Bootstrap tooltip after its title changes. |
| `activeLanguage` | Language of the current session. It does not change without a reload. |
| `readLanguagePreference()` / `saveLanguagePreference(language)` | Read and verify the next-startup preference. Saving returns `{ saved, reason }`. |
| `supportedLanguages`, `fallbackLanguage`, `storageKey` | Constants for tests and diagnostics. |

Use semantic keys such as `streetInspector.laneDirections`, not translated prose
as identifiers. Use named parameters (`{{name}}`, `{{count}}`) and i18next plural
suffixes (`_one`, `_other`, and locale-specific forms such as Spanish `_many`).

### DOM annotations

- `data-i18n="key"` replaces the element's direct text. Child elements, icons,
  listeners, IDs, and Bootstrap targets are preserved. Put the annotation on a
  leaf or on the element that owns the text, not on a container with unrelated
  descendants.
- `data-i18n-attr="aria-label:key;data-bs-title:key"` sets translated attributes.
  Use it for accessible names, tooltips, and placeholders. Bootstrap targets and
  `data-bs-*` behavior attributes are never translated.
- Keys used only by HTML are listed in `src/locales/non-js-keys.json`. This
  inventory is mandatory because extraction cannot see HTML attributes, and
  `removeUnusedKeys` is disabled so extraction never prunes them.

## Catalogs and tooling

- `src/locales/{es,en}/translation.json` are the source of truth. Edit them by
  hand, then run `pnpm --filter v1 locales:build` to regenerate
  `src/locales/catalogs.js`.
- `pnpm --filter v1 locales:status` runs `i18next-cli status` plus repository
  validation: key/placeholder/plural parity, non-empty production values, and
  the HTML/Python inventory. The configured call patterns are `tr(...)`,
  `fluviI18n.t(...)`, and the `fluviNotify` severity methods. `pnpm --filter v1
  test` runs the same checks before Vitest, so a key missing from both catalogs
  fails the test task rather than only a manual command.
- `pnpm --filter v1 locales:extract` is an extraction helper. It may propose new
  keys; review the diff and translate them by hand. Do not run automatic
  instrumentation over classic scripts, and do not translate state identifiers,
  enum values, street/building names, or stored JSON keys.
- `i18next-cli` is evaluated against Node `>=22` (the repository uses Node 24)
  and scans only `src/js/**/*.js`. Vendored libraries, generated catalogs, tests,
  `dist/`, and `apps/v2` are excluded.
- Node validation deliberately removes one English fixture key and asserts that
  i18next returns readable Spanish. Production catalogs must still pass parity,
  so a missing production key fails the focused checks.

The static build runs the catalog freshness check before copying. The
real-browser harness covers Spanish and English startup, persistence, invalid and
blocked preferences, state-preserving changes, running-session behavior, and
notification severities.

## Preference and session behavior

The saved key is `fluvi.interfaceLanguage` and accepts only `es` or `en`. The
browser language is intentionally ignored in this release. The selector in the
sidebar's global settings shows the autonyms **Español** and **English** and
controls the next startup, not the current session.

Changing the selector:

- saves and verifies the preference;
- shows a notice in the active session language;
- does not reload, pause, reset, clear edits, or otherwise mutate the simulation;
- leaves `<html lang>` and all visible text in the active language.

If storage is unavailable or read-back verification fails, the selector remains
usable, the notice explains that the preference was not saved, and the active
session is unchanged. There is no immediate-reload action in this slice; if one
is added later it must confirm the loss of unsaved maps and simulation state and
leave the session intact on cancellation.

## Notification contract

Migrated call sites use `window.fluviNotify` with an explicit severity and a
catalog key:

```js
window.fluviNotify.error("notifications.streetSelection.required");
window.fluviNotify.success(
  "notifications.simulation.changesAppliedLaneChange",
  { name: calle.nombre, laneChange: 12 },
);
```

The legacy `mostrarNotificacion`, `mostrarExito`, `mostrarError`,
`mostrarAdvertencia`, `mostrarInfo`, `mostrarConfirmacion`, and `window.alert`
paths remain available for callers that have not been migrated. Translated
titles are selected from the explicit severity; toast bodies use text nodes, so
interpolated names and numbers cannot inject markup. Confirmation defaults are
translated (`common.confirm`, `common.cancel`) while caller-supplied button text
is preserved.

## Settings, help, and project information

The sidebar's application settings and the About/Instructions modals are
annotated with `data-i18n` and `data-i18n-attr` like the rest of the static UI:

- `settings.*` owns the language description, dark-mode, console-log, visual
  debug, and cell-detection labels and tooltip. `cellDetectionControl.js`,
  `consoleControl.js`, and the dark-mode handler in `core/trafico.js` replace
  their stateful labels through `tr()` so switching a setting does not fall
  back to hard-coded Spanish.
- `about.*` owns the Sobre FLUVI summary, the shared project title used by the
  about dialog, its modal buttons, and the version/year labels.
- `guide.*` owns the complete instructions modal, including navigation,
  editing, shortcut explanations, metric interpretation, and analyzer guidance.
  Shortcut keys stay in `<kbd>` elements.
- `aboutModal.*` owns the about-dialog prose, algorithm descriptions, warnings,
  and credit headings. Developer/director names, emails, institution names,
  `FLUVI`, `IPN`, and `ESCOM` remain untranslated proper names.

When adding prose to those dialogs, annotate the leaf that owns the text. For a
sentence with nested `<strong>`, `<kbd>`, badges, or icons, split the surrounding
text into spans and translate the nested element separately; do not annotate a
container that already has emphasised child text, or the translated sentence
would duplicate the child.

Focused coverage lives in `tests/localization.spec.mjs`: both languages, desktop
and mobile viewports, light and dark themes, settings control reachability,
translated labels/tooltips, preserved shortcut/credit content, and modal bounds
without horizontal overflow.

## Virtual time and traffic profiles

`core/tiempo.js` keeps the numeric clock convention (`0=Sunday` … `6=Saturday`),
`SEGUNDOS_POR_PASO`, multipliers and profile persistence independent of the
active language. Only display names and descriptions come from the catalogs:

- `NOMBRES_DIAS` is built from `virtualTime.weekday.*` for the sidebar/modal
  clock, previews and profile messages; weekday `<option>` labels come from the
  static `virtualTime.weekdayOption.*` annotations.
- `NOMBRES_DIAS_EXPORTACION`, `obtenerDiaExportacion`,
  `obtenerTimestampExportacion` and `obtenerTimestampCortoExportacion` remain
  the stable Spanish/numeric export format.
- `ui/timeControl.js` renders the sidebar clock and modal preview through
  `NOMBRES_DIAS`, and reports failures with `fluviNotify`.
- `ui/multiplicadoresUI.js` translates generated slider labels/titles, copy and
  restore dialogs, and apply feedback. Slider badges keep dot decimals so
  localized number formatting never reaches profile values or saved maps.

The catalog owner is `virtualTime.*`. Numeric day values, profile arrays,
`tiempoToJSON`/`tiempoFromJSON` keys and clock calculations must not be
translated.

## Terminology

Keep the distinction from `CONTEXT.md`:

- **Conexión entre calles (street connection)**: a directed transfer between
  lanes/cells of two streets. English UI: “street connection”.
- **Calle de tipo CONEXION**: a street whose `tipo` value is `conexion`. Spanish
  UI: “Conexión (tipo de calle)”; English UI: “CONEXION (street type)”.

Do not use “connection street” for a link between streets. Preserve stored
identifiers (`tipo: "conexion"`, connection types, IDs, artwork keys, JSON keys)
and user-authored street, building, and scenario names in every language.
