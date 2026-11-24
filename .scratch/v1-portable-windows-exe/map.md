# Portable Windows executable

## Notes

See [the parent spec](spec.md) and [implementation ticket](issues/01-portable-desktop-package.md).

## Decisions-so-far

- Resolved [01 — portable desktop package](issues/01-portable-desktop-package.md): separate Electron workspace, unchanged static payload, fixed loopback origin/profile, safe renderer, explicit Windows x64 portable build, focused HTTP/content tests and passing development/packaged Linux smoke. Full v1 suite: 56 files, 331 tests passed. See the ticket for exact commands and [desktop.md](../../docs/v1/desktop.md) for the release procedure.

## Fog

- Actual Windows artifact build and standard-user acceptance remain unexecuted. Do not call the Windows release validated until the documented EXE acceptance checklist passes and the tester records the Windows build and artifact SHA-256.
