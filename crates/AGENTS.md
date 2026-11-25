# CA Lab crate rules

Dependency direction: `ca-app → {ca-gpu, ca-analysis} → ca-core`.
The GPU API re-exports core grid/sample types to preserve this graph.
Core owns grids, rules and the CPU reference; GPU owns kernels, rendering and
readback; analysis owns the bounded Polars worker; app owns UI and message routing.
Core must remain independent of GPU, UI and Polars.

Verify APIs against the pinned registry source, not memory. Use `eframe::wgpu`
in the app and the exact matching wgpu version in the standalone GPU crate.
Check profiler/UI compatibility before changing dependency versions.

Keep mutable frame state owned in callback resources. Use bounded, non-blocking
channels between modules. Keep application locks and heap allocations out of
the simulation/render hot path; framework/profiler internals have their own costs.
Allocate GPU buffers, bind groups and pipelines at startup or reset.
Display reads storage buffers directly; GPU readback is only for statistics/tests.
Poll staging buffers without waiting on the UI thread. Label GPU objects.
Shader-facing data needs repr(C), Pod/Zeroable and size assertions.
Every new rule or kernel needs an independent CPU-oracle comparison.

For verification stages, cache policy, logging and profiling, read
`../docs/ca-lab/development.md`. Completion requires passing CI and windowed smoke;
a successful dependency build alone does not demonstrate a working feature.
