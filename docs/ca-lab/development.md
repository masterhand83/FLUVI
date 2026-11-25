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
`hit_test` uses axis-aligned cell footprints, matching the tracer-map renderer;
later curved geometry must supply its own footprint check.

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
