# Implement the portable desktop package

Status: ready-for-agent
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
