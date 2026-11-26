# Optional GPU street-update investigation

**Decision: close ticket 34 without merging the GPU kernel.** The trial GPU path
did not improve full-tick time on the development laptop. No advanced-settings
mode switch is added. CPU simulation remains unchanged.

## CPU baseline

Run on the development laptop:

```sh
cargo run -p ca-core --example profile_street_update
```

Recorded on 2026-11-26: Ryzen 7 5700U, Linux 6.8.0-151-generic,
development profile with optimization level 1. Each workload starts at 50%
vehicle fill with seed 42. One 100-tick block warms up the model; six more
100-tick blocks supply 600 samples. Each block restores the initial state
outside the timed region to avoid measuring an empty drained map.

Phase hooks measure wall-clock time. Street-update time includes CPU parking
resolution. The synthetic maps have two opposite lanes per street, 250 cells
per lane, and generation probability 0.35. They have no connections, parking,
rain, or obstacles. The lane-change variant uses probability 0.1. The campus
retains its saved network configuration.

| Workload | Cells | Tick median / p95 | Street update median / p95 | Lane changes median / p95 |
| --- | ---: | ---: | ---: | ---: |
| Campus | 8,425 | 0.128 / 0.163 ms | 0.055 / 0.074 ms | 0.070 / 0.090 ms |
| Large | 64,000 | 0.419 / 0.457 ms | 0.415 / 0.453 ms | 0.000 / 0.000 ms |
| Map cell limit | 1,000,000 | 8.151 / 8.807 ms | 7.814 / 8.335 ms | 0.006 / 0.007 ms |
| Map cell limit, lane changes | 1,000,000 | 19.759 / 22.536 ms | 8.094 / 9.155 ms | 11.289 / 13.390 ms |

These are model timings, not full-app frame times. They exclude UI, metrics,
clock advancement, traffic packing, GPU uploads, and rendering. The campus
windowed smoke run passed at 121.5 render frames/s, with 180 frames and 14 ticks.
It briefly overlapped the CPU benchmark. Use the isolated comparison below for
the performance decision, not this early baseline.

The map-limit CPU tick exceeds an 8.33 ms budget with lane changes, but remains
below the documented 33.33 ms minimum frame budget in these samples. The windowed
comparison below establishes a substantial CPU tick cost on the large map.

## Readback constraint

CPU phases consume the previous completed street state. Moving only the street
update to the GPU therefore requires returning its result to the CPU before the
next tick. CPU metrics, heatmap snapshots, edits, and exports also use that state.

The user approved an exception for non-blocking simulation GPU readback on
2026-11-26. The readback path must use preallocated storage and must not wait on
the UI thread. Moving the dependent phases to the GPU instead would exceed
the ticket's initial street-only scope.

The trial path uses this exception. It is not part of the retained app.

## Windowed frame-rate gate

The native app benchmark uses the real UI, traffic metrics, uploads, and rendering.
It supplies the same initial document to the UI session and render startup worker.
Normal app startup still uses the campus, 10 ticks/s, and running traffic.

```sh
cargo run -p ca-app --example profile_traffic_frames -- --paused
cargo run -p ca-app --example profile_traffic_frames
```

The synthetic workload has 2,000 two-lane streets and 1,000,000 cells, at 50%
initial vehicle fill. Lane-change probability is 0.1. The requested rate is
60 ticks/s; each run stops after 600 completed render callbacks. The window is
1100 × 850 logical pixels on AMD Radeon Graphics (RADV RENOIR), Vulkan.
These tests must run separately, without other benchmarks or verification builds.

The paused baseline completed 600 frames with zero ticks at **4.7 render frames/s**
in its last one-second reporting window. Compilation took 6.60 seconds and is
not part of that rate. This is already below the 30 frames/s minimum while no
street updates run. It does not identify which UI or rendering work is responsible.

The running comparison completed 600 frames and 4,793 ticks at **2.3 render
frames/s** and 18.4 completed ticks/s in its final reporting windows. The scheduler
limits work to eight ticks per frame. CPU ticks reduce frame rate substantially,
but removing street-update work alone cannot fix the paused frame-rate limit.

For shorter runs or smaller maps, use `--frames=180 --streets=128`.
`--rate=10` selects the normal app tick rate. Each street has 500 physical cells;
the maximum accepted street count is 2,000. Rates use the app's completed
one-second render window and short simulation sampling window, not a run average.
The running workload can drain its initial traffic over time, so final rates
alone must not be used to claim an isolated kernel speedup.

## GPU trial and decision

The trial kernel runs one workgroup per lane. It uses snapshot inputs and a
separate result buffer for ordinary and periodic streets, both directions,
single-cell lanes, sinks, waiting flags, parking-consumed/spawned cells, and
outgoing connections. Connections, parking decisions, lane changes, generation,
and rain remain on the CPU. Buffers, bind groups, and the pipeline are allocated
once before ticks. Result mapping uses non-waiting device polls.

The independent CPU reference is the unchanged `TrafficModel::tick`. A test
compared every cell after every completed GPU tick on 12 seeded random networks,
18 streets each, for 80 ticks per network. It included connections, parking,
lane changes, obstacles, and rain, and also compared parking occupancy. It passed.

The isolated wall-clock comparison alternates CPU/GPU execution order. Both
models start from identical seed-42, 50%-filled snapshots. Eight ten-tick blocks
restore that initial state outside the timed region; the first two blocks warm
up the paths. The remaining 60 samples per mode supply these results:

| Workload | CPU median / p95 | GPU median / p95 | GPU median change |
| --- | ---: | ---: | ---: |
| 64,000 cells | 1.107 / 1.251 ms | 1.473 / 2.280 ms | +33.1% |
| 1,000,000 cells | 18.550 / 20.612 ms | 18.695 / 20.903 ms | +0.8% |

These are complete **model tick** costs, not kernel-only GPU timestamps. The GPU
path includes CPU pre-phases, snapshot packing, uploads, submission, result
readback, CPU result validation/installation, and rain. Neither mode includes
UI, clock advancement, metrics, or display packing/rendering. Test-only polling
waits for each result so the timing includes completion rather than submission
alone. A live asynchronous scheduler could overlap work, but that benefit was
not measured. No full-app GPU mode or frame-rate improvement is claimed.

An earlier comparison also found no median gain: CPU/GPU were
1.105/1.224 ms at 64,000 cells and 18.414/18.433 ms at 1,000,000 cells. That run
briefly overlapped the oracle test; the table uses the isolated repeat.

The ticket explicitly says to close without merging if there is no gain.
The trial kernel, core tick split, and tests were therefore removed from the
tracked change. Only the profiling tools, startup-document injection needed by
the windowed tool, and this report are retained.

The local, unmerged prototype is saved at
`.scratch/v1-to-v2-port/profiling/ticket-34-gpu-prototype.patch`.
It is not part of the commit. To repeat the experiment on this checkout:

```sh
git apply .scratch/v1-to-v2-port/profiling/ticket-34-gpu-prototype.patch
cargo test -p ca-gpu --test street_update random_networks_match_cpu_after_every_completed_tick
cargo test -p ca-gpu --test street_update benchmark_street_update -- --ignored --nocapture
```

Do not run the oracle and timing test together when collecting performance data.
The GPU trial was not integrated into the live UI because this measured path
showed no gain. A future attempt needs a measured end-to-end benefit before
adding a saved rendering/simulation mode switch.

## Verification of retained changes

Recorded after removing the trial kernel:

- `cargo check --workspace --all-targets`: passed.
- `cargo fmt --all -- --check` and `cargo dev lint`: passed.
- Verification-tool tests: 8 passed.
- Focused campus, traffic, and parking tests: 25 passed.
- `cargo dev test`: 371 passed, 1 skipped.

`cargo dev smoke` also passed: 180 frames, 29 ticks, 65 vehicles,
60.1 render frames/s, and 10.9 completed ticks/s in the final reporting windows.
These smoke rates are a functional check, not a controlled timing comparison.
Standards and spec review have no open findings; the windowed tool now rejects
an early window close instead of reporting an incomplete run as successful.
