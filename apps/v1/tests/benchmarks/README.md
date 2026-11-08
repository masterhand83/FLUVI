# Canvas road-surface direct baseline

Run `pnpm --filter v1 bench:road-surface` with Chrome or Chromium installed
(`CHROME_PATH` overrides detection). The harness uses headless Chrome with
`--disable-gpu`, a 1440×900 viewport, device scale factor 1, and seed 97.
Each case warms up for five iterations and measures 30 iterations. The synthetic
case adds 200 deterministic two-lane, 80-cell streets to the built-in map.

The report includes browser version, canvas dimensions, zoom, street and cell
counts, roundabout count, and median/p95 milliseconds. Surface timings measure
separate direct drawing calls on a detached canvas; manual-step timings include
simulation and rendering. These synchronous timings are not FPS or GPU
completion times. Compare later implementations on the same machine and browser;
do not use absolute timing thresholds in CI.

The browser equivalence test uses exact byte equality because both contexts have
the same dimensions and camera transform, with no resampling. A future test that
resamples must limit tolerance to antialiased edge pixels rather than accepting
arbitrary image-wide differences, so missing cells and clipping remain visible.

## Recorded direct run (2026-11-07)

Chrome 157.0.8103.38, headless `--disable-gpu`, viewport 1440×900,
canvas 1050×857, density 1, zoom 1, seed 97; 5 warmups and 30 samples.
Times in milliseconds are machine-specific and are not acceptance limits.

| Case | Streets | Cells | Surface median / p95 | Manual step median / p95 |
| --- | ---: | ---: | ---: | ---: |
| Built-in | 85 | 8,425 | 62.7 / 73.3 | 43.7 / 75.9 |
| Synthetic | 285 | 40,425 | 72.1 / 96.4 | 58.9 / 114.7 |

The synthetic geometry includes offscreen cells; the cell count measures submitted
road-tile work, not the number of pixels rasterized. The two timings are collected
separately, so their medians need not add up or have a fixed ordering.
