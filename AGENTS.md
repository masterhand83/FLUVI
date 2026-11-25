## v1 navigation — read first

For work involving `apps/v1/`, read `docs/v1/application-map.md` **before searching or opening v1 source files**. Use its feature-to-file routes and line ranges to inspect only the relevant fragments; search beyond the map when a route is missing or stale. For large-file prioritization, see `docs/v1/largest-files.md`. Update the map when changing ownership, load order, public globals, or the documented ranges substantially.

## Testing

Never write tautological tests. Check required behavior with expected results that are independent of the implementation.

For web apps, run focused tests with `pnpm test`, filtering to the affected modules, files, or use cases rather than running the entire test suite by default.

`pnpm --filter v1 test` is the fast default: it runs unit checks plus the metrics, analyzer-localization, and camera browser specs. `pnpm --filter v1 test:fast` is an alias. Run the affected feature spec directly when changing that feature. Use `pnpm --filter v1 test:full` before shipping browser-sensitive changes; it runs the serial browser suite plus i18next status while excluding the flaky `export-timestamps` spec and Python analyzer compatibility check. Run those with `pnpm --filter v1 test:quarantine` when changing their features; the Python check needs pandas/matplotlib or `uv`.

## Implementation

- Deepen modules and simplify their interfaces. Keep complex logic inside modules, behind small, clear interfaces.
- Write clean, simple implementations. Use only the complexity needed to meet the requirements. Avoid overengineering.
- Prefer real-time visual updates for app drags, handles, and edits. Update the affected shape and controls during input, rather than only after commit. Use validated, cancellable previews when intermediate values must not change saved state. Reuse unchanged previews to keep input responsive.

## Communication

Use ASD-STE100 Simplified Technical English in all responses.

## CA Lab navigation

For Rust crates, the root Cargo configuration, or CA Lab development tooling,
read `docs/ca-lab/development.md` before building or running verification.
Crate architecture rules are scoped in `crates/AGENTS.md`. Dependency versions
are authoritative in root `Cargo.toml`; avoid copying version lists into instructions.
