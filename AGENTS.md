## v1 navigation — read first

For work involving `apps/v1/`, read `docs/v1/application-map.md` **before searching or opening v1 source files**. Use its feature-to-file routes and line ranges to inspect only the relevant fragments; search beyond the map when a route is missing or stale. For large-file prioritization, see `docs/v1/largest-files.md`. Update the map when changing ownership, load order, public globals, or the documented ranges substantially.

## Testing

Run focused tests with `pnpm test`, filtering to the affected modules, files, or use cases rather than running the entire test suite by default.

`pnpm --filter v1 test` is the fast default: it runs every unit check plus the core startup/localization and current metrics browser specs, while skipping every other spec that imports the Puppeteer harness. `pnpm --filter v1 test:fast` is an explicit alias for the same run. Run the affected feature spec directly when changing that feature. Use `pnpm --filter v1 test:full` before shipping browser-sensitive changes; it runs the serial browser suite plus i18next status while excluding the known-flaky `map-labels`, `building-localization`, and `export-timestamps` specs. Run those explicitly with `pnpm --filter v1 test:quarantine` (or by path) when changing their features.

## Agent skills

### Issue tracker

Issues are local Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five canonical triage roles. See `docs/agents/triage-labels.md`.

### Domain docs

Uses a multi-context layout. See `docs/agents/domain.md`.
