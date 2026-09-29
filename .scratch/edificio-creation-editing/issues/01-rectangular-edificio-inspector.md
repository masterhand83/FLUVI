# 01: Instant rectangular Edificio editing and palette

**What to build:** Let a map editor create an Edificio rectangular by dragging out its footprint, then select and edit it through one unified inspector and map handles. Valid changes take effect immediately. Preserve existing rectangular Edificios and their colors on old maps.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Drag from one corner to the other and create exactly one Edificio on release, with independent width and height; proportion lock permits a square.
- [x] The inspector and handles provide name, position, size, rotation, and color editing with immediate application and no building-wide preview, Save, or Cancel.
- [x] Reject invalid intermediate numeric or geometry values without corrupting the last valid Edificio state; selecting another building shows the correct values.
- [x] Offer fixed brown, grey, blue, sky, green, and a distinct legacy-brown `#8B4513` option to all shape buildings; do not offer arbitrary color entry.
- [x] Existing non-palette colors remain unchanged until explicitly replaced by a palette choice; the inspector does not misidentify their active color.
- [x] New and older rectangular buildings remain selectable, movable, render correctly in Canvas and Pixi, and survive a fresh-app JSON round trip without appearance or position changes.
- [x] Focused browser tests cover creation, edits, square lock, color choice, invalid input, older map compatibility, and exactly one creation per gesture in both graphics modes.
