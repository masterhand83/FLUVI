# Campus rendering measurement

Run this command on the development laptop:

```sh
cargo run -p ca-app -- --smoke-frames 1200
```

Recorded locally on 2026-11-24 (UTC log: 2026-11-25 05:35):

| Item | Result |
| --- | --- |
| Campus | 85 streets, 8,425 cells, 203 connections |
| Adapter | AMD Radeon Graphics (RADV RENOIR), integrated GPU |
| Driver | Mesa 25.2.8, Vulkan |
| Window | 1100 × 850 logical pixels |
| Build | Development profile, optimization level 1 |
| Display | **120.0 render frames/s**, last completed one-second window |
| Run | 1,200 frames, 99 completed traffic ticks, 192 vehicles at exit |
| Traffic | 10 ticks/s requested; 11.0 ticks/s reported at exit |

Use 30 render frames/s as the minimum acceptance target on this laptop.
The measured display rate exceeds that target. Keep simulation tick rate
separate from render frame rate; the two counters measure different work.
The smoke run includes the campus zone and connection arrows.

Use oriented cell instances for display. Upload their geometry at
startup or map replacement. On a vertex edit, update only that street in
preallocated storage and upload its instance range. Keep the zone triangles
in a static GPU buffer; draw labels between the zone and traffic callbacks.
Upload traffic values after
completed ticks and paused edits. Avoid a full-screen loop over every lane
for each output pixel.

The driver reported an unavailable optional Vulkan validation layer and an
initial suboptimal presentation warning. The app completed the run without
a wgpu validation error. This measurement covers the fitted startup view,
not every zoom level or street-edit workload.

## Optional vehicle heat mode

Run the GPU timestamp comparison:

```sh
cargo test -p ca-gpu --test vehicle_heat benchmark_vehicle_styles -- --ignored --nocapture
```

Recorded locally on 2026-11-26, on the same AMD integrated GPU and Mesa 25.2.8
Vulkan driver. Development profile, 1152 × 448 offscreen target, fitted view,
50% random vehicle fill. After two warm-up rounds, twelve rounds alternate mode
order and record 32 passes per mode: 384 measured samples per mode and workload.

| Workload | Normal median | Heat median | Normal p95 | Heat p95 | Median added cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| Campus, 8,425 cells | 39.8 µs | 59.1 µs | 165.4 µs | 196.4 µs | 19.3 µs (+48.6%) |
| 128 two-lane streets, 65,536 cells | 226.3 µs | 409.2 µs | 277.0 µs | 445.8 µs | 182.9 µs (+80.8%) |

These are GPU traffic-pass times, including target clear/store and lane arrows.
They exclude simulation, UI, buildings, presentation, startup compilation, and
CPU submission time. They are not full-app frame rates. Timestamp readback is
test-only and occurs after each batch. The benchmark is not a timing gate in CI.
Clock state and other GPU activity can change these numbers.

The heat calculation has a real cost, but the measured median increase is about
0.02 ms on the campus and 0.18 ms on the larger map. This is a small part of an
8.33 ms frame budget at 120 Hz. This measurement does not guarantee unchanged
frame rates on every map, adapter, viewport, or vehicle fill. The normal pipeline
compiles out heat-window reads and calculations; both modes share the same cell
uploads and draw calls.
