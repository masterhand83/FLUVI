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

## Street drawing and inspection

The street workflow uses these catalog owners:

- `streetDrawing.*`: Draw/roundabout tool labels, tooltips, and the short
  retry/invalid-radius cues.
- `streetEditor.*`: the new-street modal, legacy visual editor controls,
  dimension/position field labels, deletion and resize confirmations, and
  geometry validation wording.
- `streetSettings.*`: global generation, street selection, generation and
  lane-change probabilities, the apply button, and related help text.
- `streetGeometry.*`: accessible names for endpoint, control, anchor, and
  roundabout-radius handles.
- `streetTooltip.cell`: the Pixi cell tooltip format. Physical zero-based cell
  indexes and the `Name : index` shape are retained.

Street names and Etiqueta content are data. Creating or selecting a street must
not translate its name, and names containing HTML-significant characters are
preserved literally in the inspector, selectors, confirmations, and toasts.
`tipo` values (`generador`, `conexion`, `devorador`), `geometryType`,
`laneDirections`, `laneGenerationEnabled`, cell/index values, JSON keys, and
public globals keep their current spelling. The UI distinguishes a street of
type CONEXION from a Conexión entre calles (street connection) in both
languages.

Browser coverage lives in `tests/street-localization.spec.mjs` (Spanish and
English, Canvas and Pixi, desktop and mobile, both themes, geometry edits,
lane/generation controls, validation, safe names, and notifications).
`tests/cell-tooltip.spec.mjs` covers the localized tooltip format and physical
cell indexes.

## Street connection drafting and editing

`ui/createLink.js` and the legacy connection controls in `ui/constructor.js`
share the `streetConnection.*` catalog owner:

- `streetConnection.panel` and `streetConnection.row` cover the map-first
  Lineal/Incorporation/Probabilistic draft: source/destination selectors,
  type-specific fields, per-lane enablement, fixed-cell review, Save/Cancel,
  and live status text.
- `streetConnection.pick`, `streetConnection.lineal`, and
  `streetConnection.position` cover map-pick guidance, fixed Lineal summaries,
  unmatched lanes, and physical first/last-cell wording. Cell indexes remain
  zero-based physical indexes; `posOrigen = -1` still displays as the last
  physical cell.
- `streetConnection.list` covers sidebar visibility, search, selected-street
  headers, empty/no-match states, edit/delete actions, and incompatible-direction
  warnings.
- `streetConnection.legacy` covers the new/edit connection modals, generated
  probabilistic exit forms, lane options, sum warnings, and assistance text.
- `streetConnection.errors`, `streetConnection.overlap`, and
  `notifications.streetConnection.*` cover validation, duplicate/direction/
  endpoint/incomplete drafts, and explicit success, warning, and error toasts.

Saved connection types (`lineal`, `incorporacion`, `probabilistica`), stored
positions, probabilities, street names, and JSON keys are data and never
translated. Street names are assigned as text or `Option` labels, so names with
HTML-significant characters remain literal in the panel, list, confirmations,
and toasts. The UI calls these mappings **Conexión entre calles** /
**street connection**; the terminology section below keeps that distinct from a
Calle whose `tipo` is `conexion`.

Browser coverage lives in `tests/connection-localization.spec.mjs` (Spanish and
English, Canvas and Pixi, correction, cancellation, saved-link reopening,
incorporation lane selection, probabilistic transfer mapping, duplicate,
direction, and incomplete-draft validation, legacy creation/edit/delete,
notification severities, safe names, desktop/mobile, and both themes).

## Building appearance workflows

Building appearance is owned by `ui/buildingInspector.js`, the building factory
and legacy building modal in `ui/constructor.js`, and the building selectors in
`ui/constructor.js` and `ui/editor.js`. These catalog owners cover it:

- `buildingDrawing.*`: the rectangular, polygon, and image-building tool labels,
  tooltips, square lock, upload guidance, and cancel action.
- `buildingInspector.*`: the immediate inspector fields and color palette, custom
  handle labels, polygon draw panel, image upload/replacement status, default
  generated names, deletion confirmation, and validation. Polygon rejection
  reasons map the technical `edificioPolygonGeometry` reason identifiers to
  translated sentences; unknown reasons keep the identifier only as an
  interpolated detail.
- `buildingEditor.*`: the legacy create/edit modal title, appearance fields,
  placeholders, and create/update/cancel actions.
- `notifications.buildingEditor.*` and `notifications.buildingInspector.*`: explicit
  warning, error, and success toasts for missing selections, invalid names/values,
  updates, and confirmed deletion.

Building labels, selector values, `appearanceMode`, `geometryType`, vertices,
colors, dimensions, `imageData`, image rotation conventions, bundled artwork keys,
and JSON keys are data and never translated. New buildings receive a generated
name in the active language, after which it is stored like any other label and is
not renamed when a later session starts in the other language. The Canvas
`canvas.title` and Pixi `EdificioRenderer` hover tooltip show the building's
stored label unchanged. Functional-parking controls and validation remain owned by
ticket 08; appearance labels never decide whether a building is parking.

Browser coverage lives in `tests/building-localization.spec.mjs` (Spanish and
English, Canvas and Pixi, rectangular/polygonal/image creation, image replacement,
invalid uploads and polygon geometry, safe names, renderer tooltips, deletion
confirmation, notification severities, desktop/mobile, and both themes).

## Functional parking

Functional parking is independent of building appearance. The unified immediate
inspector in `ui/buildingInspector.js`, the legacy building modal in
`index.html`/`ui/edificioUI.js`, and the shared validation in
`core/estacionamientos.js` use one catalog owner, `parking.*`:

- `parking.inspector.*`: immediate-inspector toggle, capacity, pair rows,
  entrance/exit labels, hourly probabilities, status text, and inline errors.
- `parking.legacy.*`: legacy modal headings, enablement, capacity, connection
  guidance, presets, generated pair rows, hourly sliders, probability accessible
  names, overlap feedback, and add/remove actions.
- `parking.field.*`: shared lane, cell, and entrance/exit street labels used by
  both the immediate inspector and generated legacy rows.
- `parking.validation.*`: incomplete pairs, pair counts, capacity/occupancy,
  endpoint ranges, duplicate endpoints, and endpoint ownership. The validator
  still returns `null` for a valid configuration and a readable message
  otherwise; `configurarEstacionamiento` remains atomic.
- `notifications.parking.*`: explicit warning/error toasts for decorative
  buildings without connections, rejected configuration, repeated pair limits,
  and missing legacy controls.
- `parking.connection.entrance`/`parking.connection.exit` and
  `parking.count.lanes`/`parking.count.cells` are shared labels used by the
  controls and street-option summaries.

Street and building names, connection `tipo` values (`entrada`/`salida`), lane
and cell indexes (including zero-based physical storage and one-based UI
numbering), probabilities, capacities, occupancy, JSON keys, and public globals
remain data. Dynamic element IDs keep their historical Spanish suffixes
(`...Entrada0`, `...Salida0`) so tests and integrations are stable.

Renderer-owned interface text stays numeric: Canvas draws the functional-parking
outline without prose, and the Pixi occupancy counter keeps the
`(occupied/capacity)` format. Map labels and building names are never translated.
The translated text does not influence spawning, connection ownership,
occupancy, cleanup, or conservation.

Browser coverage lives in `tests/parking-localization.spec.mjs` (Spanish and
English, Canvas and Pixi, valid configuration, rejected edits that preserve live
mappings, legacy controls, notification severities, safe names, desktop/mobile,
and both themes). Existing behavior regressions remain in
`tests/parking-configuration.spec.mjs`, `tests/parking-building-inspector.spec.mjs`,
and `tests/parking-conservation.spec.mjs`.

## Scenario configuration and exchange

Scenario setup, presets, and exchange use one catalog owner, `scenarios.*`:

- `scenarios.cards.*` covers the lane-block, flood, random-rain, and obstacle
  cards: titles, descriptions, toggles, tooltips, paint-mode badges and
  instructions, obstacle type labels/options, and the `role="status"`/
  `aria-live="polite"` paint indicators. Random-rain probabilities remain
  numeric percentages.
- `scenarios.presets.*` covers the base-scenario cards and their Load badges;
  `scenarios.management.*`, `scenarios.current.*`, `scenarios.saveModal.*`, and
  `scenarios.loadModal.*` cover save/load/import controls, current-scenario
  status, the naming and description form, the browser list, delete actions,
  and empty states.
- `scenarios.validation.*` reports missing streets, changed lengths or lane
  counts, and malformed scenario files. `scenarios.clear.*`,
  `scenarios.notifications.*`, `scenarios.alerts.*`, `scenarios.stats.*`, and
  `scenarios.list.*` cover the clear-all button and confirmation actions,
  explicit success/warning/error feedback, and interpolated counts. Toast bodies use text nodes; names and counts cannot
  inject markup.
- Base scenario names and descriptions (`scenarios.base.*`) are generated in
  the active language and then stored like any other scenario content. Their
  stable IDs remain `base_inundacion_masiva` and
  `base_baches_aleatorios`.

Stored scenario fields (`version`, `id`, `nombre`, `descripcion`,
`callesConfig`, `celdasBloqueadas`, `lluviaAleatoria`, `estadisticas`), cell
types (`bloqueo`, `inundacion`, `obstaculo`), obstacle textures (`bache`,
`trabajador`, `arbol`, `inundacion`), street/building names, probabilities, and
cell indexes are data. Scenario JSON never gains a language or localization
field, and importing or re-saving in the other language preserves every stored
value. Loading always turns random rain off while restoring the saved
probability; older files without one use 10%.

Browser coverage lives in `tests/scenario-localization.spec.mjs`: Spanish and
English controls and accessible descriptions, base-scenario generation, Canvas
and Pixi disruption rendering, cross-language save/load/import round trips,
rain load-off behavior, safe names, notification severities, desktop/mobile
reachability, and both themes.

## Traffic metrics and compatible exports

Traffic metrics use one catalog owner, `metrics.*`:

- `metrics.status.*` covers the status panel: stable classification titles and
  descriptions, metric labels, observation headings, and every observation and
  recommendation. `interpretarMetricas` returns a stable `level` identifier
  (`collapse`, `optimal`, `congested`, `underused`, `moderate`), presentation
  emoji/color/CSS class, and observation descriptors (`{ key, params }`).
  `actualizarPanelInterpretacion` translates those descriptors through the active
  catalog. Classification thresholds, measured values, units, and the status CSS
  classes remain unchanged by language.
- `metrics.labels.*` covers the short density, throughput, speed, and
  net-generation labels used by the status panel and chart tooltips.
- `metrics.charts.*` covers the five chart headings and accessible names, dataset
  labels, concise tooltip titles/values, and the entropy tick suffix. Tooltips keep
  a timestamp title plus at most a value and one short status line; long
  explanatory prose stays in the status panel.
- `metrics.streetSelection.*` covers the street-selection modal, the generated
  checkbox labels (stored street name plus lane/cell counts), accessible checkbox
  names, the included-street counter, and the map-selection mode button. Stored
  street names, physical indexes, and selection state are data.
- `metrics.export.*` and `metrics.clear.*` cover the CSV/JSON/image/analyze
  controls, help text, legacy-format notice, and the clear confirmation.
  `notifications.metrics.*` covers empty-history, success, and missing-heatmap
  feedback with explicit severity.

CSV and JSON exports never change format with the interface language. The CSV
keeps its Spanish metadata layout, column order, `ESTADISTICAS` markers, legacy
Spanish weekday names, parser-compatible timestamps, and dot decimal separators.
JSON keeps its keys, types, Spanish `metricsDescription`, and history behavior.
The translated export notice explains this compatibility exception instead of
introducing localized export variants. Download filenames also keep the legacy
export day name.

Browser coverage lives in `tests/metrics-localization.spec.mjs` (both languages,
all five classifications, chart dataset/tooltip labels, actual pointer hover at
low/middle/high values and after updates, street selection, export copy,
notification severity, both themes, and mobile/desktop layouts). Export
compatibility is covered by `tests/export-timestamps.spec.mjs`, which downloads
CSV/JSON in both interface languages and parses them with the real Python reader
alongside the legacy fixtures.

## Heatmaps and metric images

The heatmap modal and the seven-image metric archive use two catalog owners:

- `metrics.heatmap.*` covers the modal title/subtitle, statistics labels, legend
  labels and descriptions, loading text, and footer explanation. The shared
  close action uses `common.close`. Static content is annotated in
  `index.html`.
  `notifications.metrics.heatmapNoStreets`, `heatmapDimensionsFailed`,
  `heatmapFailed`, and `heatmapUnavailable` use explicit warning/error severity
  and keyed catalog messages. The no-streets path reports a warning instead of
  opening an empty modal. A missing bounding box reports the specific dimensions
  failure in the modal and supplies the thrown reason for the offscreen export
  path, whose caller still reports the generic image-export failure.
- `metrics.imageExport.*` covers the five chart y-axis unit titles, the virtual
  time axis, the summary table headers, entropy row, observations heading,
  no-observation fallback, data-scope notes (including plural chart counts and
  included/total street interpolation), heatmap scale labels, and the
  `metrics.export.imagesExporting` temporary button label. Export failures use
  `notifications.metrics.imagesExportFailed`; an empty history uses the existing
  `notifications.metrics.nothingToExport` warning.

The image archive keeps its existing seven filenames, white background, 1600px
width, chart layout, table/notes placement, legend geometry, and no added titles
or subtitles. Only human-readable drawing text follows the active session
language. Dataset labels already come from the localized live chart
configuration; exported charts still clone and replace the full
`completeMetricsHistory` window, while live charts and JSON keep the latest-50
window. The offscreen heatmap render uses the same `getLocalDensity`,
`getColorForDensity`, street iteration, and map bounds in both languages, and
never opens or changes the modal. Exporting also does not mutate live chart
data, selection state, or the active simulation.

Browser coverage lives in `tests/heatmap-metric-images-localization.spec.mjs`:
Spanish and English with both Canvas and Pixi, translated modal/legend/stat
content, accessible close labels, actual downloaded ZIP inspection for all seven
PNGs, captured text from the exported chart/summary/heatmap rendering, absent
foreign-language sentinels, unchanged live chart data, no modal opening, and
desktop/mobile plus light/dark layout checks. Existing regressions remain in
`tests/heatmap-density.spec.mjs` (five-cell density, roundabout wrapping,
obstacle handling, lane locality, and full street coverage),
`tests/metrics-images.spec.mjs` (readable ZIP contents and warning severity),
and `tests/metric-image-export.spec.mjs` (full-history export without mutating
live charts or JSON).

## Map constructor, reference images, and map labels

The map lifecycle, reference-image, and label controls use three catalog owners:

- `mapConstructor.*` and `notifications.map.*` cover the simulation-management
  heading, new/save/load buttons and tooltips, the save-name prompt, the
  new/load confirmations, and success/error toasts. The load summary reports
  street, building, and street-connection counts with named interpolation;
  omitted content produces a separate warning toast, and malformed JSON reports
  a translated reason. Cancelling a prompt, confirmation, or load leaves the
  current map and unsaved edits untouched. A generated default simulation name
  follows the active language and is then stored as ordinary map data, like a
  street or building name; no language field is added to the payload.
- `referenceImage.*` covers the upload/link/remove controls, URL field and
  placeholder, lock/unlock wording, show/opacity labels, alignment help,
  selection and handle accessible names, the broken-link marker, and failure
  messages. Upload and link failures use `fluviNotify` error severity with a
  translated reason. A failed linked image keeps its placement and settings so
  it can be replaced, and replacing a local image validates before mutation.
- `mapLabels.*` covers the visibility dropdown (including its accessible name),
  its No labels/Streets/Buildings/Both options, the pixel-size field, and the
  positive-integer validation message. `ui/etiquetas.js` and both renderers
  continue to draw the stored street/building name unchanged; label visibility
  and font size remain session-only and are not persisted.

Map saves contain no language or localization preference field, and choosing a
different startup language never rewrites map names, geometry, lane settings,
transfer mappings, parking configuration, reference images, uploaded artwork,
bundled-image keys, or JSON identifiers. `ui/constructor.js` keeps its existing
replacement and asynchronous-load guards: a cancelled confirmation returns
before `limpiarSimulacionActual`, and newer requests invalidate older image or
map loads.

Browser coverage lives in `tests/map-constructor-localization.spec.mjs`
(Spanish/English, Canvas/Pixi, reference image upload/link/removal/alignment,
lock/visibility/opacity, broken-link recovery, save/load/new cancellation and
confirmation, malformed imports, notification severities, safe names, map-label
names, cross-language map round trips in both directions, desktop/mobile, and
both themes).

## Terminology

Keep the distinction from `CONTEXT.md`:

- **Conexión entre calles (street connection)**: a directed transfer between
  lanes/cells of two streets. English UI: “street connection”.
- **Calle de tipo CONEXION**: a street whose `tipo` value is `conexion`. Spanish
  UI: “Conexión (tipo de calle)”; English UI: “CONEXION (street type)”.

Do not use “connection street” for a link between streets. Preserve stored
identifiers (`tipo: "conexion"`, connection types, IDs, artwork keys, JSON keys)
and user-authored street, building, and scenario names in every language.
