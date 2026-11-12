# FLUVI v1 — Simple Requirements

Use this document to check what a user must be able to do in FLUVI v1.

**Source:** [`v1_map.md`](../../v1_map.md), snapshot dated 2026-11-04.  
**Status:** Requirements derived from the documented application, not a new roadmap or a record of passing tests.  
**Reading time:** About 5 minutes.

## 1. Purpose and scope

Users must be able to build a road map, simulate traffic, introduce disruptions, and inspect the results in a web browser.

Read “must” as required v1 behavior. Use the requirement IDs when reporting a missing or broken feature.

### Small glossary

- **Cell:** One road position that can hold a vehicle or an obstruction.
- **Lane:** A row of cells with its own travel direction.
- **Connection:** A one-way link that lets vehicles move between roads.
- **Scenario:** A saved disruption setup, such as blocked cells or rain settings.
- **Functional parking:** A building configured to receive and release vehicles.

## 2. Run and control traffic

1. **SIM-01:** Users must be able to play, pause, advance one step, and change simulation speed.
2. **SIM-02:** Users must be able to generate vehicles on enabled lanes, set road generation probabilities, and apply a session-wide override without losing those road settings.
3. **SIM-03:** Users must be able to run traffic with six vehicle types, lane-specific directions, compatible lane changes, road connections, and continuous circulation on roundabouts.
4. **SIM-04:** Users must be able to add or remove vehicles by selecting cells, clear vehicles, and randomly fill roads without removing obstructions.
5. **SIM-05:** Users must be able to see the step count, vehicle population, virtual clock, traffic status, and completed simulation steps per second.

## 3. Build and edit roads

1. **ROAD-01:** Users must be able to start with the built-in campus map or create an empty map.
2. **ROAD-02:** Users must be able to draw straight roads, diagonal roads, and roundabouts directly on the map.
3. **ROAD-03:** Users must be able to edit road names, positions, angles, sizes, lane counts, road types, lane directions, and generation settings.
4. **ROAD-04:** Users must be able to move, resize, and rotate roads; create and reshape curves; and edit curve control points. Users must receive an error when a proposed geometry is invalid.
5. **ROAD-05:** Users must be able to delete roads or selected curve points and cancel an edit session. Users must retain valid dependent connections and parking references after edits, with obsolete references removed or reconciled.

## 4. Connect roads

1. **LINK-01:** Users must be able to pick source and destination cells on the map and preview a directed connection before saving it.
2. **LINK-02:** Users must be able to create direct lane links, merge links, and links with destination probabilities.
3. **LINK-03:** Users must receive validation errors for invalid endpoints, incompatible directions, duplicate mappings, and invalid probabilities.
4. **LINK-04:** Users must be able to save or cancel a draft, search saved connections, edit their mappings, delete them, and show or hide connection arrows.

## 5. Add buildings and parking

1. **BUILD-01:** Users must be able to draw rectangular or polygon buildings and place uploaded PNG, JPEG, or WebP artwork up to 5 MB per image.
2. **BUILD-02:** Users must be able to edit building names and appearance, move or rotate buildings, resize image buildings proportionally, replace artwork, and delete buildings with confirmation.
3. **PARK-01:** Users must be able to enable functional parking by setting capacity, paired road entry/exit cells, and hourly entry/exit probabilities. Users must receive validation errors for invalid or conflicting endpoints.
4. **PARK-02:** Users must be able to inspect parking occupancy and show parking outlines and links. Users must not gain or lose vehicles through duplicate parking transfers, or exceed parking capacity.
5. **PARK-03:** Users must be able to disable or delete parking without leaving road endpoints reserved. Users must be able to place decorative parking artwork without enabling functional parking.

## 6. Test disruptions

1. **SCEN-01:** Users must be able to place and clear road blocks, floods, and available obstacle types.
2. **SCEN-02:** Users must be able to apply mass-flood and random-pothole presets.
3. **SCEN-03:** Users must be able to start or stop random rain and set its probability. Users must retain existing vehicles and obstructions when rain adds floods to empty cells; stopping rain must leave existing floods in place.
4. **SCEN-04:** Users must be able to name scenarios, save them in the browser, download or import scenario JSON, load saved scenarios, and delete them.
5. **SCEN-05:** Users must be able to restore saved rain probability without automatically restarting rain. Users must see floods remain stationary during traffic movement.

## 7. Set time and traffic demand

1. **TIME-01:** Users must be able to set the virtual date and time. Users must see the clock advance on a completed simulation step, including a manual step while paused.
2. **TIME-02:** Users must be able to enable or disable hourly traffic profiles and edit 24 hourly generation multipliers for each day of the week.
3. **TIME-03:** Users must be able to apply profile presets, copy a profile to all days, and restore defaults for the selected scope.
4. **TIME-04:** Users must be able to apply a new scenario time with a traffic reset while retaining the map, disruptions, and configuration.

## 8. Inspect and export results

1. **DATA-01:** Users must be able to view five live metrics: vehicle density, net population-change rate, estimated speed, estimated throughput, and traffic-pattern entropy. Users must also receive a plain-language traffic-status explanation.
2. **DATA-02:** Users must be able to choose which roads contribute to those metrics and clear recorded measurements.
3. **DATA-03:** Users must be able to inspect a current-density heatmap covering all roads, independently of the selected metric roads.
4. **DATA-04:** Users must be able to download CSV or JSON measurements and a ZIP containing seven PNG reports: five charts, a status summary, and a current heatmap. Users must receive full recorded history in CSV and chart-image exports, and the latest history window in live charts and JSON.
5. **DATA-05:** Users must receive consistent metric definitions: density counts vehicles rather than obstacles; net population change uses completed-step elapsed time. Users must see speed and throughput described as simulation estimates, without claims of measured km/h or calibrated road capacity.

## 9. Analyze exported measurements

1. **ANALYZE-01:** Users must be able to upload supported CSV or JSON measurements for Python analysis inside the browser.
2. **ANALYZE-02:** Users must be able to inspect statistical results and temporal, fundamental-diagram, and distribution plots, then download plots individually or together.
3. **ANALYZE-03:** Users must receive loading feedback and readable errors. Users must not see results from an older upload replace those from a newer analysis session.
4. **ANALYZE-04:** Users must be able to close the analyzer and clear its results, then reopen it without reinitializing an already-loaded Python runtime.

## 10. Save and restore maps

1. **SAVE-01:** Users must be able to download and reload map JSON containing roads, connections, buildings, embedded artwork, parking, clock/profiles, scenarios, reference-image alignment, background zones, and saved map appearance.
2. **SAVE-02:** Users must receive confirmation before replacing a map through new-map or load-map actions. Users who cancel must retain the current session.
3. **SAVE-03:** Users must receive validation feedback for malformed saved data or unavailable images. Users must not have an older image load or deferred operation overwrite a newer map.
4. **SAVE-04:** Users must be able to upload or link a reference image, then move, proportionally resize, rotate, lock, hide, change its opacity, or remove it.
5. **SAVE-05:** Users must be able to save with Ctrl+S or Cmd+S. Users must receive compatible saved identifiers, export fields, and export timestamps regardless of interface language.

## 11. Navigate and use the interface

1. **UI-01:** Users must be able to pan, zoom, and navigate with a minimap. Mobile users must be able to use touch and pinch gestures with a responsive, collapsible sidebar.
2. **UI-02:** Users must be able to use the shared simulation and editing model through Pixi or Canvas rendering, with Canvas fallback when Pixi initialization fails.
3. **UI-03:** Users must be able to use Spanish or English, with Spanish as the default/fallback. Users must be able to save a language choice for the next startup without changing the current simulation or its numeric results.
4. **UI-04:** Users must be able to choose a persistent dark theme, toggle road/building labels, and select a map background with day/night shading. Users must not expect label visibility preferences to be stored in map JSON.
5. **UI-05:** Users must receive translated loading messages, validation errors, notifications, and confirmations, and be able to open instructions and project information. Users must see entered names as text rather than executable HTML.

## 12. Operating limits

- Users run the simulation in a browser served by static hosting; users do not need a simulation backend or server database.
- Users may need internet access for CDN libraries and the Python analyzer; users are not promised full offline operation.
- Users do not receive accounts, shared editing, or a general undo/redo history in this v1 scope.
- Reviewers must not infer performance targets, browser-version guarantees, or accessibility certification from the source map; the team must agree those separately.

## 13. Check before accepting changes

Treat each requirement above as expected behavior, not a checked-off result. Reviewers should use these five checks:

1. Build a small map, connect two roads, and run traffic through the connection.
2. Add functional parking and a disruption; check vehicle counts and parking capacity.
3. Save the map, reload it, and compare its geometry and saved settings.
4. Export measurements and reports, then open the measurements in the analyzer.
5. Check affected workflows in both languages and both renderers, including a mobile-sized screen; run focused automated tests for the changed feature.
