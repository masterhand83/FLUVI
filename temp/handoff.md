# Handoff: optional map cell/lane picker

## Where the conversation stands

The user asked whether we could add an optional mouse selector that fills origin and destination lane/cell fields. I answered yes and proposed a per-row **Pick on map** control: click the origin cell, then the destination cell; manual inputs and current Save validation remain. The user has **not yet confirmed or requested implementation** of this new feature.

## Relevant existing work

- Issue 06 is at `.scratch/v1-street-workflows-implementation/issues/06-configure-and-edit-connection-types.md`.
- Map-first Lineal/Incorporation/Probabilistic drafting and saved-link editing were committed in `e5ccfc5` and `239757b`; inspect those commits rather than reproducing the implementation here.
- Owner: `apps/v1/src/js/ui/createLink.js`; panel: `apps/v1/index.html`; saved-link search: `apps/v1/src/js/ui/constructor.js`. `window.cellGeometryIndex.findNearest(worldX, worldY, window.calles)` yields `{ calle, carril, indice }` and handles curved cells. The existing street picker uses `window.encontrarCalleEnPunto`, which returns the street without a lane/cell. Reuse `createLink.js`'s Canvas/Pixi screen-to-world conversion and preserve its draft-only, atomic Save behavior.
- Browser checks: `apps/v1/tests/smoke/create-link.mjs` and `apps/v1/tests/smoke/connection-types.mjs`. Before opening any v1 source in a new session, read `docs/v1/application-map.md` per `AGENTS.md`.

## Cautions and next step

- Do not assume a map click should change every expanded Incorporation row; make the active row and origin/destination pick phase explicit. Keep map picking optional and avoid conflict with the initial street-selection gesture, Canvas/Pixi editing gestures, and Cancel/Escape.
- Numerous pre-existing, unrelated workspace edits remain uncommitted (including portions of `index.html`, `package.json`, and the application map). Do not reset, overwrite, or stage them wholesale.
- The previous implementation passed `pnpm test` and `pnpm --filter v1 test:smoke`; `street-edit.mjs` intermittently failed during smoke runs but passed on retries. Repo-wide lint has pre-existing violations; scoped lint passed.
- Next: clarify whether the user wants implementation and whether a per-row two-click picker is the desired interaction. If confirmed, implement and cover Canvas/Pixi behavior plus Cancel and invalid picks.

## Suggested skills

- `codebase-design` for settling the opt-in row/pick interaction if the user wants UX design first.
- `implement` and `tdd` if the user explicitly asks to build the feature.
- `code-review` after a new implementation is committed, using the pre-work commit as the review fixed point.
