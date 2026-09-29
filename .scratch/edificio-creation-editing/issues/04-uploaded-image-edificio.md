# 04: Uploaded-image Edificio creation

**What to build:** Let a map editor upload artwork and place a proportionally sized Edificio con imagen by clicking its center on the map, then edit its position, size, and rotation without changing modes.

**Blocked by:** 01 — Instant rectangular Edificio editing and palette.

**Status:** resolved

- [x] Accept decodable PNG, JPEG, and WebP files no larger than 5 MB; report and reject unsupported, oversized, or corrupt inputs before a building is created.
- [x] A successful upload followed by a map-center click creates exactly one building immediately, at a usable initial display size that preserves image proportions.
- [x] The unified inspector and map handles move, rotate, and proportionally resize the image; there is no arbitrary stretch, building-wide preview, Save/Cancel, or mode conversion.
- [x] Embed image bytes in exported JSON and restore a usable building on a fresh-app load in both Canvas and Pixi, without serializing transient browser objects or letting stale asynchronous image work overwrite a newer map.
- [x] Uploaded image buildings display a rectangular footprint and select at their visible bounds; previously saved maps without this mode still load.
- [x] Focused browser tests cover upload rejection, placement, proportional editing, renderer visibility, and fresh-app JSON round trips.

## Implementation notes

- Uploaded images use `appearanceMode: "uploaded-image"` and embedded `imageData`; decoded `imageElement` and Pixi resources are transient. Initial maximum display dimension: 120 world units.
- Shared upload/import validation checks actual PNG/JPEG/WebP signatures, a 5 MB byte limit and successful decoding. Map replacement invalidates pending uploads and stale import work.
- Focused browser coverage: `apps/v1/tests/uploaded-image-building-inspector.spec.mjs` and `apps/v1/tests/uploaded-building-persistence.spec.mjs` (16 passing tests across Canvas and Pixi, including a renamed GIF rejection).
- Two-axis review completed; the unsupported-content finding was fixed and verified. A small legacy/new rotation-convention duplication remains a nonblocking standards heuristic.
- Validation: full repository `pnpm test` passed; classic-script syntax and focused UI/test lint passed. The touched legacy source files retain the same 38 pre-existing lint diagnostics.
