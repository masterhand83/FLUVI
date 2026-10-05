# Simulation metrics audit handoff

## Request and status

The user requested: “Make a revision of the simulation metrics. Check if calculation formulae is correct.” An audit was completed in Plan mode; no application files were changed. Plan mode has now ended. The latest request is to save this handoff under `./temp/`.

Next session should continue from the audit, confirm any metric-definition choices needed, and implement corrections if requested. No implementation spec, issue, or plan was created for this task. The recommendation to revise the metrics has not yet been explicitly approved as an implementation scope.

## Repository navigation and constraints

- Working directory: `/home/robin/Programming/FLUVI`.
- Follow root `AGENTS.md`: read `docs/v1/application-map.md` before inspecting v1 source. It was read during this audit and provides feature routes; ranges can be stale.
- Read root `CONTEXT.md` and `docs/agents/domain.md` for terminology. No ADRs or nested v1 `AGENTS.md` were found during exploration.
- v1 runtime uses classic browser scripts and shared globals, not runtime ES-module imports. Account for load order and exposed globals when changing interfaces.
- Focus tests with `pnpm --filter v1 test <test-paths>`.
- There are substantial pre-existing user changes. Do not revert them. Prior `git status --short` showed changes in v1 HTML, traffic, roundabout geometry, renderers, building/street inspectors, constructor/editor, labels, tests, map documentation, plus untracked domain/issues/temp artifacts. Check current status before editing.
- Existing `temp/handoff.md` and `temp/v1-parking-system-analysis.md` belong to other work; they were not overwritten.

## Main implementation locations

- `apps/v1/src/js/core/graficas.js`: metric/history state at lines 7–106; classification at 118–325; `calculateMetrics` at 333–485; sampling/history at 491–548; reset at 559–587; charts thereafter; exports at 1067–1235; included-street selection at 1367–1448.
- `apps/v1/src/js/core/trafico.js`: generation at 993–1014; ordinary street update at 1016–1149; roundabout update at 1153–1200; nested `paso` at 4451–4503.
- `apps/v1/src/js/core/reglas.js`: values 1–6 are vehicle types, 0 empty, 7 immobile obstacle.
- `apps/v1/src/js/core/tiempo.js`: `SEGUNDOS_POR_PASO = 2.0` at line 11; clock advance at 168–198; short timestamp at 262–268; virtual milliseconds at 282–288.
- `apps/v1/src/js/ui/HeatmapModal.js`: render at 80 onward, incorrect density color formula at 177–180, vehicle stats correctly filter 1–6 at 265–268.
- `apps/v1/src/python/analizador.py`: loaders at 54–197; calendar reconstruction at 199–238; classification at 240–260; capacity/density bins at 304–332; critical-event heuristics at 334–355.
- Relevant existing tests: `apps/v1/tests/lane-direction-metrics.spec.mjs` and `apps/v1/tests/metrics-images.spec.mjs`.

## Confirmed audit findings

### 1. Vehicle density/count includes obstacles

`graficas.js:388` uses `cellValue > 0`, counting value 7 as a vehicle and even as potentially moving if its next cell is empty. Vehicle population must filter 1–6 consistently. `100 * N / C` is a valid occupancy percentage once N is correct. Decide explicitly whether C includes all physical cells or only usable cells; do not silently change that definition.

### 2. Net population rate loses sign and has a bad initial baseline

`graficas.js:458` calculates `Math.abs(totalCars - previousCarCount) / timeDiff`. It should preserve the sign. On the first observation, `lastFlowMeasure` is set but `previousCarCount` remains 0, so an unchanged initial population appears as growth on the next observation.

Use `(N_current - N_previous) / elapsed_simulated_seconds`, initializing population and time together. This is net population change of the selected road region, not source generation alone: cross-region transfers and parking also change it.

### 3. Speed is available-space proxy, not measured movement

`graficas.js:390–393` counts vehicles with an empty next cell in the current snapshot. It does not measure movement that occurred during a tick and ignores waiting, connection restrictions, parking, transfers, and lane changes. The metric wraps every road endpoint modulo road length, although only roundabouts are periodic. Actual ordinary street CA uses nonperiodic neighbors (`trafico.js:1084–1088`).

A read-only harness exercised the real `actualizarCalle` on a waiting vehicle: state `[0,1,0,0]` remained unchanged, but `calculateMetrics` reported speed 100%.

Before implementation, define speed (actual moved fraction versus average longitudinal displacement/time) and treatment of transfers, lane changes, parking, creation, and removal. Instrumenting actual motion events is more reliable than matching types in snapshots, because types are not unique vehicle identities.

### 4. Throughput units and time scale are wrong

`graficas.js:472–475` computes `(N / C) * (speedPercent / 100) * 10`, using a hardcoded approximation of updates per real second. The simulation defines 2 simulated seconds per tick. Under an ideal one-cell-per-tick CA, normalized mean longitudinal flow is `k * v`, with k in vehicles/lane-cell and v in cells/simulated second. This is mean flow per lane-cell boundary, not aggregate exits from the network.

Alternating `[1,0,1,0]` produces 5.00 in the existing implementation versus 0.25 veh/s per boundary for the ideal periodic movement reference. This establishes a 20x time-scale discrepancy, not a claim that 0.25 is total network exit throughput.

Recommend separately defining normalized traffic flow and network exit throughput (exit count / elapsed simulation time). Recalibrate any flow-based labels after defining units; do not merely replace 10 and retain incompatible thresholds.

### 5. Entropy formula is valid but its input/description is wrong

`H = -sum(p_i * log2(p_i))` is correct for the eight binary three-cell neighborhood patterns (0–3 bits). The code counts neighborhoods in `previousStreetStates`; it never incorporates the resulting state, so it is not transition entropy. Previous state is only updated on entropy calculation ticks (every 60 ticks), introducing an additional sampling lag beyond the cache.

For a test that first observes alternating occupancy and then all-empty occupancy, entropy remains 1.000 even at an entropy calculation call; current all-empty neighborhood entropy should be 0. Decide whether to retain explicitly named current neighborhood entropy or introduce a genuine temporal transition metric with its own definition/range. Use geometry-aware boundaries and an explicit obstacle policy.

### 6. Heatmap colors are vehicle type, not density

`HeatmapModal.js:178` uses `(7 - valor) / 6` for vehicle values 1–6. These are categorical vehicle types, not density/speed states. Equal traffic arrangements get different “density” colors when only types differ. Define a local spatial occupancy neighborhood/window, independent of type, and clarify whether heatmap scope follows selected roads.

## Additional issues found by inspection

- `obtenerMillisVirtuales` uses day-of-week rather than monotonic elapsed time. Saturday 23:59:58 → Sunday 00:00:00 yields -604798 seconds rather than +2. Since rates only update for `timeDiff >= 1`, they can freeze after weekly rollover. Clock edits can also corrupt rate intervals. `avanzarTiempo` does not advance when paused or disabled; inspect manual-step behavior before choosing elapsed-time semantics.
- Included-street functions do not reset rate/entropy baselines. Changing scope creates artificial population changes. Index-based selection also merits care when roads are removed/reordered.
- `calculateMetrics` without `window.calles` returns legacy `flow` but omits `netGeneration` and `throughput`, risking NaNs in consumers.
- Net-generation chart uses a y-axis minimum of 0 (`graficas.js:817`), hiding negative values after fixing the sign.
- JS and Python classifications disagree: JS optimal ignores flow while Python requires flow >= 2.5; congested density thresholds are >60 vs >65; sub-utilized differs too. These are heuristics, not established physical “maximum efficiency” proofs.
- Python density bins `[0, 0.5, 1.0, 1.5, 2.0, 3.0, max_density + 0.1]` (`analizador.py:316`) mismatch 0–100 percentages and can be nonmonotonic for low maximum densities. Critical-event density peak height 2.0 and low-speed <85 heuristics also need review/calibration.
- Python reconstructs weekday from an assumed Monday and uses a hardcoded start date; exports contain only time-of-day samples. Prefer explicit elapsed/time metadata if revising exports.
- CSV exports complete history, JSON exports the chart-limited last 50 samples. Decide whether this is intentional and align descriptions/schema accordingly.

## Executed validation (no test files added)

An inline `node --input-type=module` harness used `node:vm` to run the actual `calculateMetrics` function sliced from source, following the approach of the existing lane-direction metric test. It asserted independent reference values and reported:

```text
FAIL obstacle-only road has zero vehicles: actual 1, expected 0
FAIL unchanged initial population has zero net change: actual 0.5, expected 0
FAIL population decreases remain negative: actual 0.5, expected -0.5
FAIL network mean CA flow uses 2 simulated seconds/step: actual 5, expected 0.25
FAIL entropy of a current all-empty snapshot is zero: actual 1, expected 0
5/5 reference checks failed against the current implementation.
```

These were audit probes, not committed regression tests. The entropy and flow expected values assume the specific proposed interpretations above; their definitions must be explicit in production tests.

A second inline harness ran actual CA update and clock functions and produced:

```text
Stationary waiting vehicle: actual update leaves [0,1,0,0] unchanged; metric reports speed=100.00%.
Saturday → Sunday clock delta: -604798 seconds (expected +2).
```

Successful focused test command:

```sh
pnpm --filter v1 test tests/lane-direction-metrics.spec.mjs tests/metrics-images.spec.mjs
```

Result: 2 files passed, 3 tests passed, 2.80 seconds. Those tests cover directional available-space measurement and image export, not physical correctness of these metrics. An earlier invocation inserted `--` before paths and timed out after 120 seconds; use the successful command shape above.

## Suggested implementation sequence

1. Confirm metric semantics: physical vs usable occupancy denominator; actual movement speed; normalized mean flow vs exit throughput; neighborhood vs transition entropy; scope of heatmap.
2. Add focused regression tests for the confirmed counting/sign/baseline errors before changing them.
3. Introduce monotonic simulation elapsed time/tick accounting, independent of animation FPS and editable calendar time.
4. Record actual relevant movement/removal events at appropriate simulation seams and aggregate them across the sampling interval. Preserve traffic update ordering: generation → transfers → lane changes → street update → clock → metrics.
5. Recompute entropy from the intended sample, fix geometry-aware boundaries, and implement a type-independent local-density heatmap.
6. Align labels, y-axis ranges, status thresholds, exports/schema/time metadata, and Python analysis. Preserve backward compatibility intentionally rather than accidentally.
7. Test empty roads, obstacles, static/dynamic populations, waiting/blocked transfers, reverse lanes, ordinary endpoints, periodic roundabouts, parking, scope changes, clock edits/rollovers, different animation speeds, and CSV/JSON consumers.
8. Update `docs/v1/application-map.md` if ownership, public globals, load order, or documented ranges change substantially.

## Suggested skills

- `tdd`: call for regression tests and corrections test-first.
- `implement`: call if the next user request explicitly authorizes implementation; establish the metric definitions as requirements first.
- `diagnosing-bugs`: call when diagnosing any additional specific failure; create a deterministic red-capable loop before hypothesizing. It was loaded during this session; this task was primarily an audit rather than a report of one known failing symptom.
- `codebase-design`: call if designing a new event-accounting/metric aggregation seam is necessary.

Do not spawn subagents unless explicitly authorized by the user or an applicable skill/instruction.
