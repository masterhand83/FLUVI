# 05: Image replacement and bundled-image compatibility

**What to build:** Let map editors replace the artwork on an existing Edificio con imagen and edit pre-feature bundled-image Edificios through the same image-mode experience, without disrupting their previous display.

**Blocked by:** 04 — Uploaded-image Edificio creation.

**Status:** resolved

- [x] Replacing artwork accepts the same validated upload formats and limit as new image buildings, while retaining the building's center and rotation.
- [x] Replacement discards both former displayed dimensions and sets a usable size from the replacement image's own proportions; it does not fit the new image inside the old bounds.
- [x] A rejected or undecodable replacement leaves the previous artwork and geometry intact.
- [x] Existing buildings displayed through bundled images remain visually unchanged on old maps, are editable as image-mode without a mode conversion control, and can have their artwork replaced by an uploaded image.
- [x] Replacements and unchanged bundled-image buildings survive export and fresh-app reload in Canvas and Pixi, without losing selection or leaving stale displayed images.
- [x] Focused browser tests cover different-proportion replacement, failed replacement, legacy bundled-image editing, and round-trip compatibility in both renderers.

## Implementation notes

- Replacement shares PNG/JPEG/WebP validation and the 5 MB limit with creation, publishes only after successful decoding, and resets both dimensions to a 120-world-unit maximum dimension.
- Bundled artwork uses image-mode inspector controls without changing saved display bounds on selection; renaming preserves each renderer's bundled artwork identity.
- Legacy replacements persist `imageRotationConvention: "legacy"` to retain historical Canvas/Pixi orientation; ordinary uploaded artwork retains its existing convention.
- Browser coverage: `apps/v1/tests/image-replacement-legacy.spec.mjs`.
- All 14 replacement/legacy browser tests pass against the isolated commit contents, without relying on pre-existing uncommitted UI edits. Classic-script syntax checks and focused inspector/test lint pass; v1 has no configured TypeScript checking task.
- Two-axis review: no hard standards violations; one nonblocking bundled-asset registry duplication heuristic. Spec review's legacy Pixi orientation and handle-alignment findings were fixed and source-level re-reviewed.
