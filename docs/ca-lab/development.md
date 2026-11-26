# FLUVI v2 development and verification

## Current architecture

The native app runs the CPU traffic model in `ca-core` and displays its lane
and vehicle buffers through `ca-gpu`. `ca-app` owns the UI, tick timing, logging,
and F12 profiler toggle. The smoke run checks completed frames, completed traffic
ticks, a non-zero vehicle count, and app errors with a real native window.

`ca-analysis` remains a workspace crate reserved for traffic metrics (ticket 25)
and file analysis (ticket 29). The initial population-statistics worker and its
Polars dependency have been removed. No analysis worker runs in this version.
When these features add a worker, use bounded input/output channels, non-blocking
result delivery, and shutdown when input closes. A slow or closed result consumer
must not block shutdown. Analysis must remain off the UI/render thread.

## Fast edit loop

The native [app shell](app-shell.md) owns localization and saved UI preferences.

### Camera and cell interaction

`ca-core::camera::Camera` owns the world/local-screen transform, cursor-anchored
zoom, resize, and pan limits. `WorldView` is the same origin/span sent to the GPU
shader. Screen points are relative to the map panel, not the native window.
Zoom is limited to 0.25–32 times the fitted scale. Pan limits retain a visible
strip of the map bounds; limits take priority over cursor anchoring.

`ca-core::cell_index::CellIndex` indexes lane-major physical cell centers.
Geometry owners call `sync` after geometry edits or map replacement. The full
coordinate signature rebuilds only changed streets, independent of traffic
values. `find_nearest` retains v1's strict one-cell radius and street/lane/index
tie order. `nearby_streets` returns topmost-first candidates. The current
`sync_oriented` supplies tangent axes for rotated cell footprint checks.
Use the same centers and axes for input and GPU display.

`ca-app::map::MapInteraction` handles mouse drag, wheel zoom, pixel-trackpad pan,
Ctrl-scroll/trackpad pinch zoom, single-touch drag, and two-finger pan/pinch.
The saved cell-detection setting controls `Name : index` hover text, not clicks.
The reusable frame callback reads bounded channels: latest view/control state
and a separate ordered cell-edit queue. A full edit queue gives a warning rather
than silently discarding a click. Paused edits upload before that frame's paint;
running edits enter the CPU model and display on the next completed tick.
Pausing before that tick publishes the edit without advancing traffic.

Focused checks: `cargo test -p ca-core --test camera --test cell_index`,
`cargo test -p ca-app --test map_interaction`, and
`cargo test -p ca-gpu --test traffic`.

### Lane changes and transport controls

`ca-core::traffic::TrafficModel` runs lane changes after connection transfers and
before the street update. Changes use adjacent lanes with the same direction,
snapshot occupancy, destination reservations, waiting flags, and v1 crossing
cancellation. Scratch buffers are allocated when a street is created, not per tick.
`scripts/generate-lane-changes.mjs` evaluates v1 to produce the independent fixture.

`ca-app::transport::TransportControls` owns session-only fill and generation
settings. Clear and Random Fill share the ordered cell-edit queue. Paused edits
publish before painting; running edits publish at the next completed tick.
Both actions preserve special cells. Global generation replaces the generator's
stored probability before the hourly multiplier and respects disabled lanes.
It never edits the stored street configuration. The virtual clock supplies the
hourly multiplier before generation.

Focused checks: `cargo test -p ca-core --test transport`,
`cargo test -p ca-app --test transport_controls --bin ca-app`, and
`cargo test -p ca-gpu --test traffic`.

### Street connections

`ca-core::connections` owns physical-cell mappings, enabled incorporation rows,
independent probability trials, legacy weighted splits, and validation message keys.
`TrafficModel::add_connection` checks
all rows before registration, including disabled rows and equivalent `-1`/last
physical-cell duplicates. Reverse lanes reject sources at the last physical cell
and destinations at cell 0, except on single-cell streets, as in v1.

Transfers run after generation and before lane changes, in registration order.
Only values 1–6 transfer. Occupied destinations mark the source as waiting for
the street update; existing waiting sources do not transfer. Independent trials
test each mapping's own chance in row order. One destination is enough and no
total is required. A completed transfer empties the source, so later competing
rows cannot transfer that same car. If a successful trial finds an occupied target,
the source waits rather than trying another target.
Legacy `weightedSplit` links retain their saved weighted-choice behavior.

The test demo connects both lane directions across its three streets.
`TrafficScene::connection_arrows` exports world-space cell-center endpoints on
topology changes. `ca-app::connections::ConnectionOverlays` transforms them with
the same view as the GPU map, clips them to the map panel, and draws after the
map callback. The toolbar checkbox hides all arrows without changing transfers.
Visibility is session-only and starts on. Its checkbox is in the control panel's
Tools section.

Focused checks: `cargo test -p ca-core --test connections` and
`cargo test -p ca-app --test connection_overlays`.

### Map-first connection drafts

Use Tools → Create Connection, then click the source and destination streets.
The fixed panel at the map's top-left edits a separate draft. Select the type
before or after picking streets. Linear links are green, incorporation links
are orange, and probabilistic links are purple, in both previews and saved arrows.
Linear links fix their cells at the source lane exit and target lane entry;
both lanes are editable. Incorporation rows fix only the source exit; each row's
source lane, target lane, and target cell are editable. Probabilistic links share
one source with editable destinations and independent probabilities from 0 to 100%.
A new probabilistic draft starts with one destination at 100%. More destinations
can be added; probabilities are not normalized and do not need to total 100%.
The traffic model and map JSON retain fractions.
Lane numbers start
at 1; physical cell numbers start at 0. Source −1 means the last physical cell.
Defaults follow each lane's directional exit and entry, including roundabouts.

`ca-app::connection_draft::ConnectionDraft` owns draft rows and validation.
For new drafts, disabled merge rows are absent from preview, validation, and the
committed link. Editing a saved link retains its disabled rows for later reuse.
Invalid probabilities and duplicate mappings disable Save with a translated reason.
Cancel, Escape, bulk selection, another drawing tool, and map replacement discard
the draft without changing live connections. Draft picking takes priority over
cell edits, geometry handles, and camera pan.
The source marker follows hovered lanes before the first pick. After the source
pick, an unfinished arrow follows the pointer and snaps to eligible target cells.
Hover does not commit a pick. Lane and cell fields update the preview while input
still has focus, without waiting for Enter or focus loss.

Save validates through `TrafficModel::validate_connection`, then uses the ordered
render edit queue and `MapDocument::add_connection`. A full queue leaves the draft
open. Registration preserves live vehicles and tick state; the next tick uses
the new link. The map codec writes v1-compatible link fields plus an optional
`independentProbabilities: true` grouping marker for new independent trials.
Unmarked v1 probabilistic rows still load as independent trials. Existing
`weightedSplit: true` links keep their original semantics for compatibility.
Removing an independent destination never changes the remaining probabilities.

Focused checks: `cargo test -p ca-app --test connection_draft` and
`cargo test -p ca-app --bin ca-app saved_connection_uses_ordered_edits`.

### Saved connections and form dialogs

Map Constructor lists saved connections. Search matches either street name
without changing saved names. Each frame reads the current lane directions, so
incompatible links show a warning after a direction edit without a reload.
Edit opens the selected link in the draft tool. Save replaces it at the same
registration index; Cancel, Close, and Escape retain the original.
New Connection opens the alternative form. Both forms and the map tool use
`ConnectionDraft::candidate` and the core validator. Saved endpoints and legacy
weighted-split semantics are retained during editing.
Saved incorporations can keep all rows disabled. Inactive saved rows do not
produce direction warnings or block replacement on direction alone; their
physical endpoints and duplicate constraints remain checked.

`MapDocument::replace_connection` and `delete_connection` keep traffic and JSON
in sync. When a legacy JSON entry contains several independent model links,
only the selected entry is split for editing; adjacent links remain in order.
Replacement validation excludes the original link, but still rejects duplicates
of other links. All commits use the ordered render edit queue. A full queue keeps
the draft open and leaves the document unchanged. Street topology edits cancel
open drafts so removed or reindexed links cannot be saved by an old index.

Focused checks: `cargo test -p ca-app --test saved_connections --test connection_draft
--test control_panel` and `cargo test -p ca-app --bin ca-app saved_connection_uses_ordered_edits`.

### Map-first street drawing and deletion

Use Draw Street, then drag on empty map space. The preview shows the quantized
one-lane footprint and cell count. Escape cancels. A completed street is selected;
Delete (Supr) removes the selected street without confirmation. Text input and
vertex mode keep keyboard priority. With Draw Street off, map drags still pan.

`ca-core::streets::StreetDraft` supplies the shared preview/commit geometry.
`MapDocument::delete_street` removes owned links and remaps surviving indices.
`ca-app::map_session::MapSession::edit_streets` is the shared edit boundary and
publishes `StreetEvent::Drawn` / `Deleted` to registered feature callbacks.
The map input refreshes its oriented cell index and selector after each edit.
Selectors use Spanish primary-strength numeric collation, with physical index
as the tie breaker. Sorting never changes model order.

Topology edits use the ordered render edit queue. They rebuild display buffers,
not the simulation session: surviving traffic, tick count, and display shift stay
unchanged. New and Open still use the full replacement boundary below.

On the map, Ctrl+click selects a street without editing its cell. Ctrl+click on
empty space clears selection, even while a drawing tool is active. Normal clicks
edit cells and retain the current street selection. Selected geometry handles
still use normal drags; Ctrl+click
does not start a handle gesture. The street selector and automatic selection
after drawing remain available.

Focused checks: `cargo test -p ca-core --test street_editing`,
`cargo test -p ca-app --test map_interaction --test street_lists --test map_session`,
and `cargo test -p ca-gpu --test traffic`.

### Street inspector and dimension reconciliation

Select a street on the map or in Street Settings to open its floating inspector.
Fields apply immediately. X/Y use the saved map's units (five units per cell).
Length and lane count commit on Enter, focus loss, or Resume so a partial typed
number cannot remove traffic or lane settings.
Probabilities are fractions from 0 to 1. Invalid input shows a translated reason
and does not change the model. Each lane has a direction and generation switch.

`StreetEdit::Update` uses the same ordered queue as drawing and deletion.
`MapDocument::reconcile_dimensions` is the shared dimension boundary. It retains
physical cells and lane settings, adds forward/enabled lanes, and removes only
out-of-range link rows. A direction edit retains cell and vehicle positions and
publishes `StreetEvent::LaneDirectionsChanged`. Saved links that now oppose a
lane direction remain in the document.
Resizing can make a saved `-1` endpoint equivalent to an explicit endpoint, or
make a link point to its own cell. Keep these saved rows and their settings;
new connection registration remains strict, and self-transfers are inert.

Structural edits pause traffic and block manual steps. Resume ends focused
inspector edits and map gestures before traffic runs again. Closing the inspector
does not resume traffic. `inspector::geometry_error_message` gives map gestures
the same translated validation wording.

The control panel owns drawing and connection display in Tools, map file actions
in Map Constructor, and street selection/global generation in Street Settings.
Pause, Resume, Step, Speed, Clear and Random Fill remain in the transport bar.

Focused checks: `cargo test -p ca-core --test street_inspector`,
`cargo test -p ca-app --test street_inspector --test control_panel`, and
`cargo test -p ca-gpu --test traffic`.

### Bulk streets, creation form, and edit sessions

Shift + left drag selects streets only when every oriented cell corner is inside
the rectangle. This gesture cancels drawing, geometry previews, focused inspector
input, and single selection before other map handlers run. The floating bulk form
edits only lane count (1–10) and physical-lane directions. Escape or Close clears
the selection. `StreetEdit::Bulk` checks every candidate and the combined cell
budget before applying the batch through the dimension reconciler. A rejected
batch leaves all streets, traffic, and links unchanged.

Map Constructor → New Street opens the alternative creation form. It uses v1 map
coordinates, angle (0–360 degrees), and generation/lane-change percentages.
`StreetEdit::Create` and map drawing use the same street factory.

The inspector's Edit Position and Angle button starts a street-local edit session.
Its origin handle moves the street; its second handle rotates it without changing
cell count. Both show live geometry previews. Save retains accepted drags; Cancel,
Close, or Escape restores the original placement and physical cells. This is not
general undo. The ordered edit queue owns a separate snapshot in the render model,
so cancellation restores live traffic rather than the UI document's stale cells.
Other structural and transport controls are disabled during this session.
Starting a bulk gesture cancels the session.

Focused checks: `cargo test -p ca-core --test bulk_streets --test street_creation
--test street_sessions` and `cargo test -p ca-app --test bulk_editor
--test street_dialog --test street_inspector --test map_interaction`.

### Roundabout streets

Use Draw Roundabout, then drag from the center to the inner radius. The live
preview shows the derived cell count. Invalid geometry shows a translated
reason. Escape cancels. Select a roundabout and drag its yellow inner-radius
handle to resize it; the inspector shows read-only radius and cell count.
Lane directions select clockwise (+1) or counterclockwise (-1) travel.

`RoundaboutDraft` owns validation and the v1 sector-count formula in cell units.
`StreetPlacement::cells` supplies circular cell centers and tangent axes for
both input and GPU display. `CalleConfig::periodic` selects a snapshot exclusion
update with wrapping in each lane. The dimension reconciler maps vehicles,
waiting cells, and link endpoints to the nearest sector angle when radius changes.
Roundabout links can use every physical cell, including the seam on reverse lanes.
The map codec validates and preserves center, radius, start angle, and geometry
type. Creation and resize use the existing ordered street edit queue and pause
boundary; Resume ends the active gesture.

Focused checks: `cargo test -p ca-core --test roundabouts`,
`cargo test -p ca-app --test map_interaction --test street_inspector`, and
`cargo test -p ca-gpu --test traffic`.

### Bézier streets

Select a straight street and use Convert to Bézier in its inspector. Select a
section's control or anchor to add a control or split that section. Splitting uses
exact De Casteljau subdivision. Select a point in the inspector or on the map;
drag its map handle to change its world position. The street cells and guide lines
update during the drag. The preview replaces the original street display, but it
does not change saved geometry, vehicles, or connections. Unchanged pointer
positions reuse the cached geometry and drawing mesh. Invalid candidates have a
red outline and a translated reason; if sampling is not possible, the live guides
and handle turn red instead. Release commits a valid edit; Escape or window focus
loss cancels the preview.
Curve strength scales the controls' perpendicular
deviation from each section's chord. Invalid edits keep the previous geometry.
Delete (Supr) removes a selected control or intermediate anchor, not the street.
The start and final endpoint cannot be removed.

`ca-core::bezier::BezierCurve` owns immutable sections and a shared sampled
geometry cache. Cell centers use arc distance and centered lane offsets, matching
v1. Display-only cubic rounding at non-collinear section seams does not change
saved anchors. The same oriented cells feed the GPU and the map hit index.
Validation rejects nonlocal lane overlap with a stable translated reason.

`StreetChange::Bezier` uses the existing ordered edit queue, pause boundary, and
dimension reconciler. Length follows arc length and is read-only in the inspector.
Origin and angle edits transform all curve points. The codec retains v1's
`bezierGeometry`, `bezierControls`, `endX/endY`, optional `bezierSegments`, and empty
`vertices`. `scripts/generate-bezier-fixtures.mjs` records independent v1 cell
coordinates for compatibility tests.

Focused checks: `cargo test -p ca-core --test bezier`,
`cargo test -p ca-app --test street_inspector --test map_interaction`, and
`cargo test -p ca-gpu --test traffic`.

### Direct geometry handles

Select a street with Ctrl+click or the street selector. Drag a yellow straight
endpoint to change its origin, angle, and cell count in one atomic edit. Drag a
roundabout's center to move it, or its radial handle to resize it. Bézier anchors
and controls retain their live curve preview. Every handle and body drag redraws
all affected lanes during input, with handles and curve guides on the live shape.
The preview replaces the original street display rather than adding a second
footprint. Drag the selected street's cells
to move its body; Bézier body picks use the oriented cell index, not its bounds.
A click without a drag still edits a cell.

`ca-app::handles::GeometryHandles` owns endpoint, roundabout, and body gestures. Handles use
the shared camera and fixed screen-space pick radii. All commits use the ordered
street-edit queue and pause boundary. `StreetChange::StraightGeometry` validates
the complete endpoint candidate before changing any saved fields, and uses the
dimension reconciler for vehicles and connections. Invalid drags retain the old
geometry and keep the inspector's translated error visible until the next gesture
or Escape. `ca-app::preview::GeometryPreview` supplies the shared display-only
geometry and cached mesh for direct handles and Bézier point edits. Unchanged
pointer positions reuse the preview; a camera or panel change refreshes its
screen coordinates. Body translation checks point bounds without resampling curves.
Only the active body drag caches source cell geometry.
Escape, focus loss, and Resume
end gestures. Active drawing tools block camera pan, including over existing
streets.

Focused checks: `cargo test -p ca-app --test map_interaction` and
`cargo test -p ca-core --test street_inspector`.

### Rectangular and polygonal buildings

Use Tools → Draw Rectangular Building for a corner-to-corner drag. Use Shift or
Square Lock to draw a square. Use Draw Polygonal Building to place vertices;
click the first vertex, press Enter, or select Finish to close the polygon.
Use Escape or Cancel to discard a draft.

Select a building to edit its stored name, coordinates, rotation, and fixed
six-color palette in the inspector. Drag the center to move, yellow handles to
resize or edit vertices, and the green handle to rotate. Use Map Constructor →
New Building to create either shape with numeric fields. Confirm Delete to
remove a building; Cancel retains all saved fields.

Keep geometry in v1 pixel coordinates in `ca-core::buildings`; convert by five
pixels per map unit at the display boundary. Reuse the v1 polygon validation
order, boundary-inclusive hit test, and error reasons. Apply a validated preview
only at gesture completion. `MapDocument::delete_building` also releases parking
endpoints and clears that building's occupancy.

Keep unknown JSON fields and custom colors when editing imported buildings.
Use the GPU zone path to retain building triangles until geometry changes.
Draw building fills below roads and their controls above roads.

Focused checks: `cargo test -p ca-core -p ca-app -p ca-gpu --test buildings`.

### Functional parking

`ca-core::parking` owns paired physical endpoints, capacity, hourly probabilities,
and live occupancy. `MapDocument::configure_parking` validates the complete
candidate before replacing owned endpoints. Disable and building deletion release
endpoints and occupancy. Street deletion remaps surviving streets; dimension
reconciliation removes complete pairs with an out-of-range endpoint.

Parking resolves inside the street-update phase, before CA rules. Retained
endpoint tables keep lookups independent of the number of buildings. Consumed
sources and spawned destinations use preallocated per-cell buffers. All decisions
read the same street snapshot, including downstream occupancy and waiting flags.
The virtual hour selects the entry/exit probabilities; missing curves default to
0.3 entry and 0.2 exit. Scenario-time reset clears occupancy without changing
configuration. Save/load retains configuration, not live parked vehicles.

`ca-app::parking::ParkingOverlays` retains world-space outlines and directed links
until `MapSession::revision` changes, including street vertex edits. Names and
artwork alone do not produce a functional outline. A bounded non-blocking channel
publishes render-owned occupancy to cached `(occupied/capacity)` labels.
Parking controls and hourly-curve editing remain ticket 22.

Focused checks: `cargo test -p ca-core -p ca-app --test parking` and
`cargo test -p ca-app --bin ca-app parking_counter`.

### Image buildings

Use Tools → Upload Image Building, select a PNG, JPEG, or WebP file of at most
5 MiB, then click the map to place it. The initial maximum dimension is 120
saved v1 world pixels. Image corner handles and inspector dimensions keep the
aspect ratio. The image inspector hides the color palette and has Replace Image.
Replacement validates first, resets the size to the new aspect ratio, and keeps
the center, saved angle, name, and selection.

`ca-app::building_images` owns signature validation, bounded file reads, image
decoding, and native file dialogs. Workers return through bounded channels.
Cancel drops the receiver. Map replacement resets `BuildingEditor`, which drops
both upload and display jobs and releases its textures. Imported data URLs remain
unchanged in `Building` and map JSON. Decodes have a 64 MiB allocation limit.

The native executable embeds the v1 artwork with `include_bytes!`; no external
asset directory is needed at run time. `ca-core::buildings::artwork` maps v1 keys
to these assets. Renaming a bundled building writes its original key to `imagen`.
Bundled images and uploads marked `imageRotationConvention: 'legacy'` use the
negative v1 angle. New uploads use the positive angle. Geometry, picking, and
handles use the same convention as the textured quad.

Images and retained GPU shape triangles draw in saved building order after the
background zones and before traffic. Per-building GPU ranges let shape callbacks
interleave with image quads without rebuilding triangle buffers. Image zones have
no opaque fill or border, so transparent pixels show the map below.
The display cache releases images after replacement or deletion. Native file
dialogs can take focus without cancelling their pending image jobs.

Focused checks: `cargo test -p ca-core -p ca-app --test building_images` and
`cargo test -p ca-core -p ca-app -p ca-gpu --test buildings`.

### Virtual clock and hourly profiles

Tools → Set Scenario Date and Time opens a weekday/time draft with a localized
preview. Apply uses the ordered render edit queue, clears vehicles and waiting
flags, resets generation and FPS, and installs the clock without a tick. It keeps
the map, blockers, generation settings, and pause state. Later metrics and parking
features register their UI resets with `MapSession::register_scenario_reset` and
extend `MapDocument::reset_scenario_time` for render-owned model state.

`ca-core::virtual_time` owns Sunday-based weekdays, the v1 default profiles, and
the fixed two seconds per completed tick. `MapDocument::tick` samples the current
hour before generation, then advances time after traffic. Manual steps use the
same path. Forecasts find the first change greater than 0.3 across the actual
weekly calendar; disabled profiles supply 1 and no forecast.

Tools → Hourly Traffic Profiles edits a separate 7 × 24 draft. Dot-decimal values
must be in 0–3. Presets, copy-to-all, and selected/weekday/weekend/all default
restoration do not change live profiles until Apply. Escape or Close discards
the draft. A full command queue retains the draft with a warning.
Starting a street edit session closes time/profile drafts, so Cancel cannot
restore old vehicles after a scenario reset. Info-bar labels are cached until
the clock, profiles, or language changes.

The map codec reads and writes v1's `configuracionTiempo`, including zeros and
`usarPerfiles`. It also reads the older `multiplicadoresPorHora` array. Maps without
a switch retain the current switch. New/Open restore the clock after feature and
info-bar reset. UI day names come from the catalogs; `Clock::export_timestamp`
always returns the Spanish day and numeric 24-hour time.

Focused checks: `cargo test -p ca-core --test virtual_time --test map_json`,
`cargo test -p ca-app --test time_dialogs --test map_session`, and
`cargo test -p ca-app --bin ca-app scenario_time_command`.

### Map files and session replacement

Use `ca-core::map_json::MapDocument` to validate map JSON before replacing
the current session. Read roads before links. Keep unowned JSON fields for
later ports; omit language preferences. Save map configuration without live
vehicles, as in v1. Display straight streets, legacy vertex curves, roundabouts,
and Bézier streets.

Keep each saved v1 probabilistic link as a `Connection::ProbabilityTrial`.
Test its probability independently at its original place in registration order.
New v2 drafts use `Connection::ProbabilityTrials` for independent per-row chances.
`Connection::Probabilistica` remains only for previously saved weighted splits;
do not group imported v1 links into that type.

Register each feature's reset in `ca-app::map_session::MapSession`.
Use the `Pause`, `Tools`, and `Features` phases in that order. Keep session
display settings outside feature resets. When adding load support, restore
buildings/parking after links, then scenarios, personalization, and the clock.
Route New and Open through `App::replace_map`; use the render command channel
to replace CPU/GPU state and discard old cell edits before the next paint.

Use `ca-app::map_files` for native dialogs and file access on a worker thread.
Keep one file job active at a time. Test Cancel and invalid files without
pausing or clearing the current session.

Run `cargo test -p ca-core --test map_json`,
`cargo test -p ca-app --test map_session`, and
`cargo test -p ca-app --bin ca-app replacing_a_session` for focused checks.
To repeat the v1 compatibility check:

```sh
node scripts/check-map-json-compat.mjs --record
cargo run -p ca-core --example map_round_trip
node scripts/check-map-json-compat.mjs
```

Keep both generated fixtures under `crates/ca-core/tests/fixtures/`.
For a desktop acceptance check, open and save a map with the native dialogs,
save with Ctrl+S/Cmd+S, and cancel New Map. Check that Cancel retains the map
and that an invalid file gives a translated error.

### Campus and legacy vertex curves

Use `node scripts/export-campus.mjs` to capture the built-in v1 campus through
`guardarSimulacion`. Commit `crates/ca-core/src/campus.json` and the independent
`tests/fixtures/campus-baseline.json` together. Do not copy the v1 construction
code. On startup, load this document in the UI and the render worker.

Use `StreetPlacement::cells` for cumulative cell centers and tangent axes.
Keep f64 integration until the final f32 conversion. Preserve v1's negative
angle convention and its centered lane offsets for legacy curves. Keep saved
vertices beyond a resized street's last cell: they still control interpolation.
Initialize missing legacy connection-street vertices at 0, every 10 cells,
and the last cell.

Press Z to pause and enter vertex mode. Ctrl+click a street, then drag a yellow
handle. Press Z again to leave the mode. Check the translated badge while
the mode is active. Ignore Z in text fields. Route each edit through the
ordered edit channel; keep vehicles and links when rebuilding display geometry.
Keep the display shift fixed during edits so other map objects do not move.
Call `sync_oriented` after each accepted edit to refresh the cell index.

Read rectangular or polygonal zones from `backgroundAreas`. Keep their color
and label fields in map JSON. Allocate their GPU triangle buffer on map
installation. Draw it in `BackgroundCallback`, then draw labels before the
traffic callback. Use ear clipping for concave polygons. On New Map, replace
the zone layer with an empty layer. Do not add a zone drawing tool.

Run `cargo test -p ca-core --test campus`,
`cargo test -p ca-app --test map_interaction`, and
`cargo test -p ca-gpu --test traffic` for focused checks. Run the app's
`zones_stay_below` test for native layer order at three display scales.
See [campus-performance.md](campus-performance.md) for the laptop measurement.

Use `cargo dev edit` or `bacon check` for compiler feedback. Run focused tests,
for example `cargo nextest run -p ca-core`, when behavior changes. `bacon` still
defaults to Clippy; its check/test/run jobs remain available.

Preserve `target/`. Use `cargo clean` only to diagnose a specific artifact problem
or when the user explicitly requests it. Profile/dependency changes can invalidate
cached results without deleting any files. Keep release/profiling settings stable
during normal edits. Read current settings from `Cargo.toml` and job count from
`.cargo/config.toml`, not from a duplicated version/profile list.

## Verification stages

| Command | Scope |
| --- | --- |
| `cargo dev edit` | Compiler check, all workspace targets |
| `cargo ci` | Format, tooling regression tests, strict Clippy, nextest |
| `cargo dev delivery` | CI stages plus the real-window smoke test |
| `cargo dev release` | Release build only; explicitly requested |
| `cargo dev status` | Latest run, stage states, commands, elapsed time and log paths |

Single stages are `check`, `fmt`, `tooling`, `lint`, `test`, `smoke`, and `release`.
For example, `cargo dev lint` records only the Clippy stage.
The command definitions and stage ordering live in `scripts/verify.py`.
The driver under `tools/ca-dev` has no dependencies on the app or its libraries.
It can run the formatter without first compiling wgpu.

Automation can call `sh scripts/cargo-ci.sh` directly, without even building the
small Cargo driver. Python 3 is required for verification tooling, not for the
native traffic app. Install missing Rust tools with:

```sh
cargo install --locked cargo-nextest
cargo install --locked bacon
```

## Background work and truthful status

For agent-driven verification, launch each expensive stage as a separate
background job. Send its result when the completion notification arrives before
starting the next stage. Do not hide check, tests, smoke and release behind one
long shell chain. Use combined workflows when a person or automation wants them.

Every run saves commands, exit codes, stage states and elapsed times under the
ignored `.verification/` directory. Compiler output goes into one log per stage;
the console prints stage boundaries and the last 30 log lines on failure.
`cargo dev status` locates the latest-started run through `.verification/latest.json`.
Stage state is `pending`, `running`, `passed`, `failed`, or `cancelled`.
Later stages remain pending after failure/cancellation. SIGINT/SIGTERM cancel the
active process group on POSIX, preserve completed results, and return nonzero.
An uncatchable kill cannot write a cancellation record; status reports an
interruption if the recorded runner PID has gone away. Logs can contain local
paths and environment-supplied diagnostics: redact them before sharing.

At hand-offs, report these separately:
- **Implemented:** code exists; do not infer this from dependencies compiling.
- **Verified:** name the passing test/smoke command and current result.
- **Pending/cancelled:** name stages not completed; never count them as passes.

Give estimates from comparable completed runs. A cached metadata-only check is
not a benchmark of full compilation. Confirm before adding a release build to
the normal edit loop. Definition of done: `cargo ci` passes and `cargo smoke`
exits 0. Report platform or display limits instead of claiming unrun checks.

## Logs, profiler and GPU inspection

```sh
RUST_LOG=ca_app=debug,ca_gpu=debug,wgpu=warn,naga=warn cargo run -p ca-app
```

wgpu's built-in helpers accept `WGPU_BACKEND`, `WGPU_VALIDATION`, `WGPU_DEBUG`,
and `WGPU_GPU_BASED_VALIDATION`. Debug builds enable validation by default.
An unavailable optional Vulkan validation layer is distinct from wgpu validation.
Startup logs record the selected adapter/backend and resolved surface format.

F12 toggles the in-app Puffin viewer and collection. Profiling is disabled in
normal operation; Puffin uses its own internal synchronization while enabled.

To capture a frame, build with `cargo build -p ca-app`. In RenderDoc, launch
`target/debug/ca-app` with the repository as working directory. Set a capture key
other than F12 if using the profiler, then capture one frame. Shader/buffer labels
identify the traffic display pipeline, lane layout, and cell storage.

## Tooling changes

Run `python3 -m unittest discover -s scripts -p test_verify.py` for the verification
runner's success/failure/cancellation tests without compiling the app.
Run `cargo check -p ca-dev` and `cargo clippy -p ca-dev -- -D warnings` for the
dependency-free Rust driver. These tests are also included in normal CI stages.
