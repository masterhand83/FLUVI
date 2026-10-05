# v1 Parking System Analysis

Date: 2026-09-29

## Summary

The v1 parking system has confirmed vehicle-conservation bugs, stale connections after building deletion, and inconsistent state after road edits. Configuration validation is stronger than runtime and lifecycle handling.

This analysis covers the current working tree, including existing uncommitted changes. No application files were changed during the audit.

## Verification

Existing focused tests: **49 passed** across five files.

```sh
pnpm --filter v1 test tests/parking-configuration.spec.mjs tests/lane-directions.spec.mjs tests/roundabout-street.spec.mjs
pnpm --filter v1 test tests/parking-building-inspector.spec.mjs tests/editor-simulation-integrity.spec.mjs
```

A deterministic, temporary Node/VM harness exercised actual source functions with fixed randomness and small fixtures:

```sh
node /tmp/opencode/parking-audit.mjs
```

It produced **11 failing invariant assertions** across the findings below. These probes reproduce function-level behavior; they are not committed regression tests or a full end-to-end verification of every symptom. The temporary harness is outside the repository and may not survive environment cleanup.

## State model

Parking state is represented in several places:

- Building configuration: `esEstacionamiento`, `conexiones`, capacity, occupancy, and hourly probability profiles.
- Street lookup maps: `conexionesEstacionamiento`, whose entries retain direct building references.
- The functional-parking predicate: validates building configuration for outlines and status.
- Renderer graphics and occupancy counters.
- Serialized building state: invalid live configurations are exported as decorative buildings with zero occupancy.

Configuration generally updates building connections and street maps together. Deletion and road resizing use separate paths, allowing these representations to disagree.

## Confirmed findings

### 1. High: parking absorption can duplicate a vehicle

**Location:** `apps/v1/src/js/core/trafico.js:1028–1147`

Absorption clears a vehicle in `nuevaCalle`, but neighboring automaton updates still read it from the original `calle.arreglo`. A neighboring cell can therefore copy a vehicle that was already parked.

**Minimal reproduction:** Place one vehicle directly on an entrance and set entry probability to 100%. After one update, parking occupancy increases by one while the same vehicle appears downstream. Confirmed for both forward and reverse lanes.

**Observed:** One initial vehicle becomes one parked vehicle plus one road vehicle. A reverse-lane fixture containing a following vehicle also increased the total from two to three.

**Impact:** Inflated vehicle counts, occupancy, and traffic metrics.

**Recommendation:** Make parking absorption and road movement share per-tick consumed-source tracking, rather than independently reading the original state.

### 2. High: a vehicle can be absorbed twice or taken from a waiting connection

**Location:** `apps/v1/src/js/core/trafico.js:1048–1066`

Anticipated entry examines an upstream vehicle without checking whether it has already been absorbed this tick or is marked as waiting.

**Confirmed reproductions:**

- Two adjacent entrances count the same vehicle twice: one initial road vehicle produces parking occupancy of two.
- An entrance absorbs a vehicle whose upstream cell has a waiting flag, removing it from the road despite that flag.

The roundabout path checks both `removed.has(source)` and `waiting[source]` in `trafico.js:1192–1193`; ordinary streets do not.

**Impact:** Broken conservation and inconsistent precedence between parking and waiting street connections.

**Recommendation:** Share consumed-source and waiting checks across ordinary streets and roundabouts. Define precedence explicitly for parking and street transfers.

### 3. High: deleting a building leaves ghost parking active

**Location:** `apps/v1/src/js/ui/constructor.js:2111–2140`

Building deletion removes the building from `window.edificios` but never calls `limpiarConexionesEdificio`. Street mappings retain a direct reference to the deleted building, whose `esEstacionamiento` remains true.

**Observed:** The deletion probe ended with zero buildings and two remaining live parking mappings.

**Impact:** Runtime parking can continue through an invisible, deleted facility. Its cells remain reserved and can block configuration of another parking building.

**Recommendation:** Remove owned mappings and deactivate parking as part of building deletion, before removing the building from the collection. Refresh parking graphics and counters through the same lifecycle path.

### 4. Medium: resizing away the last pair does not deactivate parking

**Location:** `apps/v1/src/js/ui/editor.js:866–894`

Road resizing prunes invalid pairs but leaves `esEstacionamiento` and occupancy unchanged when no pairs survive.

**Confirmed resulting state:**

```text
esEstacionamiento: true
conexiones: []
vehiculosActuales: 3
```

Consumers then disagree:

- The functional-parking predicate considers the building nonfunctional.
- Occupancy counters still consider it parking.
- Saving converts it to decorative and exports occupancy as zero.

Explicit disabling clears occupancy (`estacionamientos.js:321–327`), whereas deleting the last connected road disables parking without clearing occupancy (`constructor.js:2049–2051`).

**Impact:** Hidden or stranded occupancy and loss of that state on save/load.

**Recommendation:** Define one policy for occupied facilities losing their last connection, then apply it consistently to disabling, resizing, deletion, and serialization.

### 5. Medium: roundabout shrinking can collapse parking endpoints onto one cell

**Location:** `apps/v1/src/js/ui/editor.js:745–763, 866–894`

Angular remapping can map distinct endpoints to the same cell. The subsequent lookup rebuild checks bounds but does not validate overlap or ownership.

**Confirmed reproduction:** Shrinking a 10-cell roundabout to three cells mapped an entrance and exit to cell zero. Both remained in the building's connections, while the street map retained only one mapping because `Map.set` overwrote the other.

Collisions between different buildings are also a source-level risk; that specific multi-building case was not exercised by the harness.

**Impact:** Runtime behavior, functional outlines, and saved state can diverge.

**Recommendation:** Validate the complete remapped configuration before committing it. Reject collisions or apply an explicit collision-resolution policy without silently overwriting owners.

### 6. Medium: ordinary Pixi link rendering deletes parking graphics

**Locations:**

- `apps/v1/src/js/renderer/renderers/ConexionRenderer.js:13–22`
- `apps/v1/src/js/renderer/PixiApp.js:174–177`

Ordinary road connections and parking graphics share `conexionGraphics`. `renderAll` removes every entry absent from the ordinary road-connection array, including parking entries keyed by strings.

**Observed:** Calling the ordinary renderer removed and destroyed an existing parking graphic.

The Pixi ticker invokes this renderer every frame while connections are visible. Parking graphics created by `renderEstacionamientos` are therefore removed on a subsequent ticker pass.

**Impact:** Parking connection lines disappear independently of the live parking configuration.

**Recommendation:** Separate parking graphics from ordinary road-link graphics, or explicitly restrict each renderer's cleanup to entries it owns.

### 7. Medium: the legacy form accepts two incomplete pairs as one complete pair

**Locations:**

- `apps/v1/src/js/ui/edificioUI.js:426–492`
- `apps/v1/src/js/core/estacionamientos.js:29–35`

The legacy collector independently drops incomplete endpoints. The core validator checks aggregate entrance/exit counts, not original pair identity.

**Confirmed reproduction:** Pair A contains only an entrance and pair B only an exit. Collection produces one entrance and one exit, which the validator accepts as a complete configuration.

The newer building inspector retains incomplete pairs in its draft, so the two interfaces behave differently.

**Impact:** An incomplete form can save a configuration that does not represent its displayed pairs. Pair-based pruning later operates on inferred entrance/exit ordering.

**Recommendation:** Preserve pair structure through collection and validation. Reject incomplete rows before flattening the connections.

### 8. Medium: probability profiles are not validated at the core/JSON boundary

**Location:** `apps/v1/src/js/core/estacionamientos.js:23–55, 110–118, 193, 223`

Validation checks capacity, occupancy, endpoints, and ownership, but not hourly probability values. Configuration checks profile length without requiring numeric, finite values in the range `[0, 1]`.

**Observed:** A 24-hour entry profile containing probability `2` was accepted as functional.

Negative or nonnumeric values can produce permanently disabled or unexpected behavior. UI validation does not protect imported JSON or other callers.

**Recommendation:** Validate both profiles at configuration and import boundaries. Decide whether malformed profiles are rejected or normalized, and report normalization rather than silently changing behavior.

## Additional risks found by inspection

These findings were identified from source, not independently reproduced end-to-end.

### Incorrect parking endpoint geometry on Bézier streets

`apps/v1/src/js/renderer/renderers/ConexionRenderer.js:159–167` requires nonempty `vertices` before using curved coordinates. Bézier streets use `bezierGeometry` and can have empty `vertices`.

The ordinary connection helper correctly recognizes both representations at `:38–43`. Parking rendering should use that same helper.

### Parking graphic key collisions

`apps/v1/src/js/renderer/renderers/ConexionRenderer.js:197` omits the street identifier from its graphic key. Two same-type endpoints belonging to the same building, on different streets but matching lane/cell indexes, collide.

The map can lose a graphic reference while the graphic remains attached to the layer, complicating cleanup and refresh.

### Vehicle types are not preserved through parking

`apps/v1/src/js/core/estacionamientos.js:197, 227–230` stores only occupancy on entry and chooses a random vehicle type on departure.

This may be intentional model simplification, rather than a bug. It nevertheless means parking changes fleet composition. If vehicle-type preservation matters, occupancy must retain type information or a per-type inventory.

## Recommended priorities

1. **Vehicle conservation:** consumed-source tracking shared between parking and movement, including adjacent entrances and waiting flags.
2. **Lifecycle consistency:** one implementation for owned-map cleanup, disabling, deletion, and road-edit reconciliation.
3. **Renderer ownership:** independent parking graphics and shared endpoint geometry helpers.
4. **Boundary validation:** complete pairs, remapping collisions, and hourly probability profiles.

## Regression tests to add

- Total road vehicles plus parked occupancy remains constant through entry/exit on an interior connection street without external generation or sinks.
- Entry from both the entrance cell and its upstream neighbor, in both lane directions.
- Adjacent entrances never consume the same vehicle twice.
- Waiting vehicles are not consumed unless explicitly allowed by the transfer policy.
- Deleting a parking building removes every owned mapping and releases its endpoints.
- Losing the last pair follows the chosen deactivation/occupancy policy, including save/load.
- Roundabout remapping never silently merges parking endpoints or overwrites another owner.
- Ordinary Pixi rendering preserves parking graphics across ticker updates.
- Incomplete legacy form rows are rejected individually.
- Invalid probability profiles are rejected or normalized according to an explicit policy.

## Conclusion

The main architectural issue is multiple independently maintained representations of parking state. Configuration handles atomic replacement reasonably well, but lifecycle operations bypass it, and ordinary-street parking is interleaved with automaton updates without tracking consumed vehicles.

The highest-value fixes are vehicle conservation, deletion cleanup, and collision-safe road-edit reconciliation. Passing the existing focused tests does not currently guarantee those properties.
