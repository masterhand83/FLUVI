# Implement the portable desktop package

Status: resolved
Blocked by: none

## Scope

Implement the parent spec in full: separate Electron workspace, unchanged static payload, secure loopback serving with persistent origin/profile, browser-compatible files, clean lifecycle, portable Windows x64 packaging, focused tests, and build/release documentation.

Context: ../spec.md

Keep all existing v1 application source unchanged. Use test-driven development at public behavior boundaries. Follow the root AGENTS.md and read the application map before v1 exploration.

## Acceptance

- Focused server and packaging tests pass.
- Existing static build and browser-sensitive suite are checked where available.
- Windows artifact acceptance is executed if possible; otherwise record the exact outstanding release gate and do not claim Windows validation.
- Documentation explains commands, network needs, extraction, profile/download locations, security warnings, and Windows acceptance procedure.
- Resolve with an implementation summary, commands and results, and explicit remaining environment limitations.

## Comments

- One frontier ticket owns the wrapper end to end to avoid artificial seams between runtime, packaging, and acceptance.

## Answer

Implemented on `implement/v1-portable-windows-exe` in `/tmp/opencode/fluvi-v1-desktop-impl`, starting from integration commit `cc870a7` with ancestry confirmed. No files under `apps/v1/` were changed; the original worktree and its user changes were left untouched.

### Runtime and build

- Added the separate `@fluvi/desktop` workspace with pinned Electron 45.4.1, electron-builder 26.18.0 and Playwright Core 1.65.1; updated the pnpm lockfile and explicit dependency-build policy. The unused Squirrel install script is denied, not broadly approved.
- Serve the unchanged production static payload on IPv4 loopback at persistent origin `http://127.0.0.1:47831`. Reject foreign Host headers, traversal, malformed paths, symlink/junction escapes and write methods. Fail on conflicts instead of silently changing origins.
- Keep a per-user `FLUVI Desktop` profile, single-instance lifecycle, isolated/sandboxed renderer with no Node integration or preload bridge, denied permissions/popups/remote navigation, normal file selection, and native Save As dialogs for exports.
- Added an explicit Windows x64 portable release command, actionable startup errors, and server cleanup on last-window close. Normal quit preserves Chromium's profile flush.
- Stage with the existing v1 static builder. Copy the complete payload outside ASAR in an `afterPack` hook and verify every file byte-for-byte, including dotfiles that electron-builder otherwise excludes. Existing web build/deploy scripts do not depend on desktop packaging.
- Documented development/build commands, network needs, extraction/profile/download locations, unsigned-build warnings, and actual Windows artifact acceptance in `docs/v1/desktop.md`; linked from the root README and application map.

### Tests and evidence

Used the parent spec's public HTTP, payload, and desktop-launch seams with red → green slices. Initial tests failed for missing implementations; the traversal regression observed an actual `200` for `/../secret.txt` before the server fix. A real packaging diagnostic caught a dropped `.gitkeep`; the final hook preserves the complete tree. The restart smoke waits for the visible loading overlay to disappear before reading the restored language.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed after updating dependencies/policy |
| `pnpm --filter @fluvi/desktop test` | 5 tests passed: HTTP/MIME/shutdown, fixed-origin conflict/rebind, path/junction security, full static-payload bytes, omitted/rewritten/extra package resources |
| `pnpm --filter @fluvi/desktop test:smoke` | Passed on graphical Linux: real Electron launch, pause/step UI, no renderer `require`, popup/navigation denial, English across full process restart, last-window close and released HTTP listener |
| `pnpm --filter @fluvi/desktop exec electron-builder --linux --dir --x64` | Passed; real packaged `resources/payload` verified byte-for-byte |
| `pnpm --filter @fluvi/desktop exec node tests/desktop-smoke.mjs /tmp/opencode/fluvi-v1-desktop-impl/apps/desktop/dist/release/linux-unpacked/FLUVI` | Same smoke passed against the packaged ASAR/runtime/payload paths |
| `pnpm --filter v1 exec vitest run tests/static-build.spec.mjs` | 2 tests passed |
| `pnpm --filter v1 build` | Passed, unchanged production web builder |
| `pnpm --filter v1 test:full` | Locale validation/status passed; 56 files and 331 tests passed (292.58 seconds) |
| `pnpm exec biome lint apps/desktop --diagnostic-level=error` | Passed |
| `git diff --check` | Passed |
| `pnpm --filter @fluvi/desktop package:win` on Linux | Intentionally rejected with the documented Windows x64 host requirement |

### Outstanding release gate and limitations

**No Windows portable EXE was built or executed in this Linux environment. Windows acceptance is not passed.** A maintainer must run `package:win` on Windows x64, publish/record the resulting SHA-256, and execute every Windows acceptance check in `docs/v1/desktop.md` on a standard-user machine without Node.js/Python, including paths with spaces/non-ASCII characters, JSON exchange, image imports, actual image/CSV/JSON/ZIP exports and native dialogs, online Python analysis, theme/scenario persistence, single-instance behavior, occupied-port error UI, and process/listener cleanup.

The Linux smoke uses Playwright's automation flags (including its `--no-sandbox` launch flag); it does not prove the Windows renderer sandbox or native-dialog behavior. An attempted automated Blob-download probe stopped at the native Save dialog and was replaced with the documented manual artifact check; no successful native export is claimed. The Linux unpacked build is a packaging diagnostic, not a supported Linux distribution.

No quarantined export-timestamps or Python compatibility run was needed because their application features were unchanged; the full-suite result above excludes the repository's quarantined files. CDN-dependent features remain network-dependent and unsigned release security warnings remain possible.
