# FLUVI v2 crate rules

Current dependency direction: `ca-app → ca-gpu → ca-core`.
Core owns the traffic model, rules, and CPU reference. GPU owns traffic packing
and rendering. App owns UI, timing, and message routing.
`ca-analysis` is reserved and has no dependencies or active worker. Future metrics
and file analysis may add `ca-app → ca-analysis → ca-core`; use bounded channels
and non-blocking result delivery. See the worker requirements in the development
guide below. Core must remain independent of GPU, UI, and analysis libraries.

Verify APIs against the pinned registry source, not memory. Use `eframe::wgpu`
in the app and the exact matching wgpu version in the standalone GPU crate.
Check profiler/UI compatibility before changing dependency versions.

Keep mutable frame state owned in callback resources. Use bounded, non-blocking
channels between modules. Keep application locks and heap allocations out of
the simulation/render hot path; framework/profiler internals have their own costs.
Allocate GPU buffers, bind groups and pipelines at startup or reset.
Display reads storage buffers directly; GPU readback is only for statistics/tests,
except user-triggered whole-map PNG and export viewport captures. These render
once into a separate opaque offscreen texture and read it back once on a worker.
One capture job may be active at a time; never modify live camera/view resources.
Poll staging buffers without waiting on the UI thread. Label GPU objects.
Shader-facing data needs repr(C), Pod/Zeroable and size assertions.
Every new rule or kernel needs an independent CPU-oracle comparison.

For verification stages, cache policy, logging and profiling, read
`../docs/ca-lab/development.md`. Completion requires passing CI and windowed smoke;
a successful dependency build alone does not demonstrate a working feature.
