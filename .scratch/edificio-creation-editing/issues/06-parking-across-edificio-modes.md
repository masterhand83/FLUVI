# 06: Reliable parking configuration across Edificio modes

**What to build:** Let a map editor enable and edit Estacionamiento funcional on rectangular, polygonal, and image-based Edificios through the unified inspector without partial or misleading parking state.

**Blocked by:** 01 — Instant rectangular Edificio editing and palette; 03 — Polygonal Edificio creation and editing; 04 — Uploaded-image Edificio creation.

**Status:** implemented

- [x] Parking can be enabled on each of the three appearance modes only when complete valid entrance/exit pairs exist; an invalid attempt displays actionable feedback and does not mark the building functional.
- [x] While a pair is being edited, existing live connections remain active until a whole valid pair can replace them atomically; invalid input cannot leave stale or half-applied street mappings.
- [x] Editing parking probabilities and capacity applies valid changes immediately; capacity cannot be lowered below current occupancy.
- [x] Turning parking off needs no confirmation and immediately clears its connections and occupancy count, leaving a decorative building of the same appearance.
- [x] A parking-themed name or image alone never creates functional parking. When functional state changes, the blue parking outline appears or disappears without hiding selection.
- [x] Save/load preserves valid parking behavior for each appearance mode and does not turn legacy decorative buildings into functional parking.
- [x] Focused browser tests cover valid and invalid pairs, capacity/occupancy, no-confirmation disable, state and outline updates, and fresh-app JSON round trips in Canvas and Pixi.

## Implementation notes

- Core validation rejects an entire invalid draft before changing owned street mappings. The unified inspector presents lane/cell numbers from 1; persisted model indexes remain zero-based.
- Image decoding preserves saved parking fields until roads exist and the dedicated restoration pass validates them. Fresh-app tests include nonzero occupancy and edited probabilities.
- Pixi polygon parking draws a wider blue stroke beneath selection so both outlines remain visible.
- Focused parking tests: 36 passed. Canvas/Pixi outline smoke and existing image persistence/replacement tests passed. Standards/spec review found no remaining blocking issues.
