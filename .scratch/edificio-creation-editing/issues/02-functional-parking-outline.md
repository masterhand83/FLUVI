# 02: Blue outline for Estacionamiento funcional

**What to build:** Let map editors recognize an Estacionamiento funcional at a glance, independently of its building's name, color, image, or selection.

**Blocked by:** None (can start immediately).

Status: ready-for-agent

- [x] Functional parking buildings have a persistent `#0066FF` outline visible in Canvas and Pixi, including when the underlying appearance is an image or blue fill.
- [x] The blue outline remains distinguishable while selection's separate outline is displayed, and updates when functional parking is activated or deactivated.
- [x] Decorative buildings with parking-related labels or bundled images, but without functional parking connections, do not gain the blue outline.
- [x] Existing maps and bundled images retain their appearance; no appearance mode or parking behavior is inferred from a label or image alone.
- [x] Focused browser tests inspect visible outlined and non-outlined buildings in both graphics modes, including selected and unselected states.
