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
