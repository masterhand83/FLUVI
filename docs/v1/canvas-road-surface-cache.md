# Canvas straight-road surface cache

## Ownership and load order

Maintainers load `src/js/renderer/CanvasRoadSurfaceCache.js` as a classic script immediately before `core/reglas.js` and `core/trafico.js`. The factory exposes `window.createCanvasRoadSurfaceCache`; `trafico.js` creates one instance at `window.canvasRoadSurface.cache` with `draw(context, street)`, `invalidate(street)`, `clear()` and read-only backing-store `bytes`.

Callers supply the camera-transformed context. The cache rasterizes straight streets in local coordinates through the shared direct rasterizer, with two transparent pixels of padding on every edge, then applies the street placement and rotation when compositing. Maintainers can still call `canvasRoadSurface.drawSurface` or `drawStreets` for direct rendering. Curves and roundabouts use that direct path in this ticket.

Engineers keep selection outlines and direction cues immediately after each street surface, preserving overlap order. Vehicles, blockers, floods, vertices, editor handles and labels remain in their existing live drawing passes. No renderer setting or saved-map field was added.

## Validity and memory contract

Engineers compare only `x`, `y`, `angulo`, `tamano`, `carriles` and cell size to validate resident straight surfaces. Traffic and scenario edits do not scan occupancy or rebuild road artwork. Existing paused-gesture redraws see current geometry through this signature; unrelated resident streets keep their rasters. The constructor explicitly invalidates deleted streets and clears all cache references during the shared New/Load cleanup.

Maintainers enforce a default 32 MiB budget using padded width × height × four bytes. The cache releases an old variant before preparing its replacement and evicts least-recently-used residents before allocating another raster. It zeroes both backing dimensions on release and sets the new width to zero before setting its height, avoiding oversized intermediate backing dimensions. The limits are 8,192 pixels per dimension and 8,388,608 pixels per surface, checked before allocation. Unsupported geometry, fractional/invalid dimensions, unavailable artwork, over-budget surfaces and preparation failures draw directly.

Engineers use detached HTML canvases; OffscreenCanvas is unnecessary. This ticket uses one raster pixel per world unit. Later tickets own curved caching, culling, zoom/density buckets and texture revisions; until then, unavailable road artwork never enters the cache.

## Verification

Engineers run `road-surface-cache.spec.mjs` for budget accounting, allocation pressure, LRU behavior, explicit release and fallback. The browser spec compares cached/direct frames after geometry and overlay changes, samples every cell center on rotated footprints, counts road-tile draws across ticks and checks backing-store release across deletion, New and repeated Load.

```sh
pnpm --filter v1 exec vitest run tests/road-surface-cache.spec.mjs tests/road-surface-cache-browser.spec.mjs tests/road-surface-drawing.spec.mjs tests/static-build.spec.mjs
pnpm --filter v1 test:full
pnpm --filter v1 build
```

For the two-road pixel fixture, engineers require byte-exact unrotated output at integer positions. Rotated output allows fewer than 3,500 changed pixels and less than 100,000 total absolute RGB-channel error per frame, reflecting two-stage texture resampling. Separate cell-center assertions reject holes that an aggregate tolerance could miss. The original direct renderer still has a byte-exact pre-refactor oracle.

## Initial matched benchmark

Run `pnpm --filter v1 bench:road-surface`. Engineers collect three paired batches per map, alternate direct/cached order, reset traffic and virtual time, use seed 97, and discard five warm-up samples before recording 30 samples. The report includes cold preparation, road-cell draw counts, backing-store bytes, and median/p95 surface-only and manual-step times. Instrumentation wraps `drawImage` in both modes; manual-step times are not user-visible FPS.

On 2026-11-07, the implementer ran Chrome 157.0.8103.38 headless with `--disable-gpu`, a 1440 × 900 viewport, a 1050 × 857 simulation canvas, pixel density 1 and zoom 1. Each table entry summarizes three batches by taking the median of their reported median/p95 values; it is not a pooled percentile.

| Map / mode | Road median / p95 (ms) | Manual-step median / p95 (ms) | Cold road (ms) | Owned bytes | Warm tiles: road + step |
| --- | ---: | ---: | ---: | ---: | ---: |
| Built-in / direct | 33.2 / 41.3 | 18.7 / 31.0 | 22.5 | 0 | 16,850 |
| Built-in / cached | 33.0 / 42.9 | 18.3 / 34.2 | 33.9 | 408,736 | 11,138 |
| Synthetic / direct | 46.8 / 58.7 | 37.2 / 70.2 | 35.9 | 0 | 80,850 |
| Synthetic / cached | 33.4 / 41.6 | 23.0 / 47.8 | 207.9 | 4,933,536 | 11,138 |

Engineers should treat the built-in result as a missed 50% warm-road target: the measured road-median reduction was only 0.6%, with no p95 improvement. The built-in map has 85 streets and 8,425 tiles, of which 5,569 remain on the per-cell transformed curved drawing path. This ticket eliminates 2,856 straight-road tile draws per scene; it deliberately leaves the expensive curve path unchanged. The synthetic case adds 200 straight streets of 80 cells × two lanes, giving 285 streets and 40,425 tiles; its road median fell 28.6% and manual-step median fell 38.2%. Maintainers need ticket 03's curved surfaces before evaluating the whole-map target again. These measurements establish the bounded straight-cache stage, not a claim of production FPS improvement.

The implementer verified an initial full v1 run (52 files, 318 tests), then reran the expanded focused cache checks (four files, 17 tests). The final full run passed 317 of 319 tests; the Spanish Canvas heatmap export intermittently reported 85/85 metric streets instead of 44/85, also causing its dependent archive comparison to fail. An immediate isolated rerun of `heatmap-metric-images-localization.spec.mjs` passed all six tests. Maintainers should retain this full-suite caveat rather than treat the isolated pass as a clean final full run. No heatmap implementation or assertions were changed for this ticket.

The implementer also verified the fast default suite (24 files, 201 tests), static-build resource checks and `pnpm --filter v1 build`; the paused street-edit and car-click performance smokes passed in Canvas and Pixi. v1 has no configured typecheck command or TypeScript project; syntax checks and focused Biome lint cover the new JavaScript instead.

## Standards review

The reviewer found no documented-standard breaches. The implementer extracted repeated browser raster-capture instrumentation after the reviewer identified possible duplication; the follow-up review found no remaining material smells.

## Spec review

The reviewer identified missing browser fallback-pixel coverage. The implementer added byte-exact comparisons for oversized surfaces, insufficient budget, unavailable artwork and allocation failure, plus successful recovery and unchanged occupancy. The follow-up reviewer found no remaining requirements findings for ticket 02.
