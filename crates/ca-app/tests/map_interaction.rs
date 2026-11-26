use ca_app::map::MapInteraction;
use eframe::egui;

#[test]
fn metric_map_selection_captures_clicks_without_cell_edits_or_bulk_selection() {
    use ca_app::map::CellPickMode;
    use ca_core::cell_index::CellRef;
    let document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":12,"x":25,"y":25}]}"#,
    )
    .unwrap();
    let geometry = document.geometry();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30., 20.], &geometry, vec!["A".into()]);
    map.configure(&document, [0.; 2]);
    map.set_cell_picking(Some(CellPickMode::Metrics));
    frame(&ctx, &mut map, vec![], false);
    let target = screen_position(&map, geometry[0].centers[0][3]);
    for modifiers in [egui::Modifiers::NONE, egui::Modifiers::SHIFT] {
        let button = |pressed| egui::Event::PointerButton {
            pos: target,
            pressed,
            button: egui::PointerButton::Primary,
            modifiers,
        };
        let picked = frame(
            &ctx,
            &mut map,
            vec![
                egui::Event::PointerMoved(target),
                button(true),
                button(false),
            ],
            false,
        );
        assert_eq!(
            picked.picked_cell,
            Some(CellRef {
                street: 0,
                lane: 0,
                index: 3
            })
        );
        assert!(picked.clicked.is_none());
        assert!(picked.street_edit.is_none());
        assert!(!picked.bulk_started);
        assert_eq!(map.selected(), None);
    }
}

#[test]
fn paint_accepts_a_complete_click_in_one_frame_and_ignores_drags_started_outside_map() {
    use ca_core::cell_index::CellRef;
    let document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":12,"x":25,"y":25}]}"#,
    )
    .unwrap();
    let ctx = egui::Context::default();
    let geometry = document.geometry();
    let mut map = MapInteraction::new([30., 20.], &geometry, vec!["A".into()]);
    map.configure(&document, [0.; 2]);
    map.set_painting(true);
    frame(&ctx, &mut map, vec![], false);
    let target = screen_position(&map, geometry[0].centers[0][3]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    let outside = egui::pos2(-10., -10.);
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(outside), button(outside, true)],
        false,
    );
    let dragged = frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(target)],
        false,
    );
    assert!(
        dragged.clicked.is_none(),
        "only map-owned gestures can paint"
    );
    frame(&ctx, &mut map, vec![button(target, false)], false);
    let batched_drag = frame(
        &ctx,
        &mut map,
        vec![
            egui::Event::PointerMoved(outside),
            button(outside, true),
            egui::Event::PointerMoved(target),
        ],
        false,
    );
    assert!(
        batched_drag.clicked.is_none(),
        "the press position must own the gesture"
    );
    frame(&ctx, &mut map, vec![button(target, false)], false);
    let clicked = frame(
        &ctx,
        &mut map,
        vec![
            egui::Event::PointerMoved(target),
            button(target, true),
            button(target, false),
        ],
        false,
    );
    assert_eq!(
        clicked.clicked,
        Some(CellRef {
            street: 0,
            lane: 0,
            index: 3
        })
    );
    assert_eq!(clicked.paint_start, clicked.clicked);
    let next = screen_position(&map, geometry[0].centers[0][6]);
    let batched_map_drag = frame(
        &ctx,
        &mut map,
        vec![
            egui::Event::PointerMoved(target),
            button(target, true),
            egui::Event::PointerMoved(next),
        ],
        false,
    );
    assert_eq!(
        batched_map_drag.paint_start,
        Some(CellRef {
            street: 0,
            lane: 0,
            index: 3
        })
    );
    assert_eq!(
        batched_map_drag.clicked,
        Some(CellRef {
            street: 0,
            lane: 0,
            index: 6
        })
    );
}

#[test]
fn disruption_painting_emits_cells_during_drag_without_panning_or_geometry_edits() {
    use ca_core::cell_index::CellRef;
    let document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":12,"carriles":2,"x":25,"y":25}]}"#,
    )
    .unwrap();
    let ctx = egui::Context::default();
    let geometry = document.geometry();
    let mut map = MapInteraction::new([30., 20.], &geometry, vec!["A".into()]);
    map.configure(&document, [0.; 2]);
    map.select(Some(0));
    map.set_painting(true);
    frame(&ctx, &mut map, vec![], false);
    let view = map.camera().unwrap().view();
    let start = screen_position(&map, geometry[0].centers[1][2]);
    let end = screen_position(&map, geometry[0].centers[1][5]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    let down = frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    assert_eq!(
        down.clicked,
        Some(CellRef {
            street: 0,
            lane: 1,
            index: 2
        })
    );
    assert_eq!(down.paint_start, down.clicked);
    let moving = frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    assert_eq!(moving.paint_start, None);
    assert_eq!(
        moving.clicked,
        Some(CellRef {
            street: 0,
            lane: 1,
            index: 5
        })
    );
    assert!(moving.street_edit.is_none() && !moving.structural_edit);
    assert_eq!(map.camera().unwrap().view(), view);
    frame(&ctx, &mut map, vec![button(end, false)], false);
    let idle = frame(&ctx, &mut map, vec![], false);
    assert!(idle.clicked.is_none());
}

#[test]
fn endpoint_picking_highlights_the_exact_lane_cell_and_does_not_edit_vehicles() {
    use ca_core::cell_index::CellRef;
    let document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":12,"carriles":2,"x":25,"y":25,"angulo":30}]}"#,
    ).unwrap();
    let ctx = egui::Context::default();
    let geometry = document.geometry();
    let mut map = MapInteraction::new([30., 20.], &geometry, vec!["A".into()]);
    map.configure(&document, [0.; 2]);
    map.select(Some(0));
    map.set_cell_picking(Some(ca_app::map::CellPickMode::Parking));
    frame(&ctx, &mut map, vec![], false);
    let pos = screen_position(&map, geometry[0].centers[1][3]);
    let hover = frame(&ctx, &mut map, vec![egui::Event::PointerMoved(pos)], false);
    let expected = CellRef {
        street: 0,
        lane: 1,
        index: 3,
    };
    assert_eq!(hover.preview.unwrap().cell, expected);
    assert!(hover.picked_cell.is_none() && hover.clicked.is_none());
    let button = |pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::SHIFT,
    };
    let pressed = frame(&ctx, &mut map, vec![button(true)], false);
    assert!(
        !pressed.bulk_started,
        "Shift must not discard an active parking pick"
    );
    assert!(pressed.street_edit.is_none() && pressed.clicked.is_none());
    let released = frame(&ctx, &mut map, vec![button(false)], false);
    assert_eq!(released.picked_cell, Some(expected));
    assert!(released.clicked.is_none() && released.street_edit.is_none());
}

#[test]
fn session_rotation_has_a_live_preview_without_resizing_cells() {
    use ca_core::streets::{StreetChange, StreetEdit};
    let mut document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":6,"x":25,"y":25}]}"#,
    )
    .unwrap();
    document.edit_streets(StreetEdit::BeginSession(0)).unwrap();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["A".into()]);
    map.configure(&document, [0.0; 2]);
    map.select(Some(0));
    frame(&ctx, &mut map, vec![], false);
    let start = screen_position(&map, [11.0, 5.0]);
    let end = screen_position(&map, [5.0, 11.0]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    let moving = frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    let preview = moving.geometry_preview.expect("live rotation");
    assert_eq!(preview.geometry.centers[0].len(), 6);
    let center = preview.geometry.centers[0][0];
    assert!((center[0] - 4.5).abs() < 0.001 && (center[1] - 5.5).abs() < 0.001);
    let released = frame(&ctx, &mut map, vec![button(end, false)], false);
    let Some(StreetEdit::Update(0, StreetChange::Angle(angle))) = released.street_edit else {
        panic!("rotation must not resize the street");
    };
    assert!((angle + 90.0).abs() < 0.001);
}

#[test]
fn shift_drag_selects_only_complete_cell_footprints_and_cancels_drawing() {
    let document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[
        {"nombre":"Inside","tipo":"conexion","tamano":4,"x":25,"y":25},
        {"nombre":"Partial","tipo":"conexion","tamano":4,"x":40,"y":35}]}"#,
    )
    .unwrap();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new(
        [30.0, 20.0],
        &document.geometry(),
        vec!["Inside".into(), "Partial".into()],
    );
    map.configure(&document, [0.0; 2]);
    map.select(Some(1));
    map.set_drawing(true);
    frame(&ctx, &mut map, vec![], false);
    let view = map.camera().unwrap().view();
    let start = screen_position(&map, [4.0, 4.0]);
    // Every center of Partial is inside; its final cell's outer edge is not.
    let end = screen_position(&map, [11.75, 9.0]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::SHIFT,
    };
    let down = frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    assert!(down.bulk_started);
    assert!(!map.drawing());
    assert_eq!(map.selected(), None);
    frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    let released = frame(&ctx, &mut map, vec![button(end, false)], false);
    assert_eq!(map.bulk_selected(), &[0]);
    assert_eq!(map.camera().unwrap().view(), view);
    assert!(released.clicked.is_none() && released.street_edit.is_none());
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::Key {
            key: egui::Key::Escape,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers: egui::Modifiers::NONE,
        }],
        false,
    );
    assert!(map.bulk_selected().is_empty());
}

#[test]
fn endpoint_drag_updates_all_lanes_before_release_and_cancel_restores_display() {
    let document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":6,"carriles":2,"x":25,"y":25}]}"#,
    )
    .unwrap();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["A".into()]);
    map.configure(&document, [2.0, 1.0]);
    map.select(Some(0));
    frame(&ctx, &mut map, vec![], false);
    let start = screen_position(&map, [13.0, 6.0]);
    let end = screen_position(&map, [15.0, 8.0]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: Default::default(),
    };
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    let (moving, output) =
        painted_frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    assert!(moving.street_edit.is_none());
    assert!(moving.structural_edit);
    let preview = moving.geometry_preview.as_ref().expect("live street shape");
    assert_eq!(preview.street, 0);
    assert_eq!(preview.geometry.centers.len(), 2);
    assert_eq!(preview.geometry.centers[0].len(), 8);
    let first = preview.geometry.centers[0][0];
    assert!((first[0] - 7.3638034).abs() < 0.001);
    assert!((first[1] - 6.606339).abs() < 0.001);
    assert!(
        output
            .shapes
            .iter()
            .any(|s| matches!(&s.shape, egui::Shape::Mesh(_)))
    );
    let idle = frame(&ctx, &mut map, vec![], false);
    assert!(std::sync::Arc::ptr_eq(
        preview,
        idle.geometry_preview.as_ref().unwrap()
    ));
    let cancelled = frame(
        &ctx,
        &mut map,
        vec![egui::Event::Key {
            key: egui::Key::Escape,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers: Default::default(),
        }],
        false,
    );
    assert!(cancelled.geometry_preview.is_none());
    assert!(cancelled.street_edit.is_none());
    let released = frame(&ctx, &mut map, vec![button(end, false)], false);
    assert!(released.geometry_preview.is_none() && released.street_edit.is_none());
}

#[test]
fn radial_handle_redraws_all_roundabout_lanes_before_commit() {
    use ca_core::streets::{StreetChange, StreetEdit};
    let document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[{"nombre":"Ring","tipo":"conexion","geometryType":"roundabout",
        "tamano":16,"carriles":2,"x":50,"y":50,"innerRadius":10,"startAngle":0}]}"#,
    )
    .unwrap();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["Ring".into()]);
    map.configure(&document, [2.0, 1.0]);
    map.select(Some(0));
    frame(&ctx, &mut map, vec![], false);
    let start = screen_position(&map, [14.0, 11.0]);
    let end = screen_position(&map, [16.0, 11.0]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: Default::default(),
    };
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    let (moving, output) =
        painted_frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    assert!(moving.street_edit.is_none());
    let preview = moving
        .geometry_preview
        .as_ref()
        .expect("live ring cell geometry");
    assert_eq!(preview.geometry.centers.len(), 2);
    assert_eq!(preview.geometry.centers[0].len(), 28);
    for (lane, radius) in [4.5_f32, 5.5].into_iter().enumerate() {
        let p = preview.geometry.centers[lane][0];
        assert!(((p[0] - 12.0).hypot(p[1] - 11.0) - radius).abs() < 0.001);
    }
    assert!(
        output.shapes.iter().any(|s| matches!(&s.shape,
            egui::Shape::Circle(circle) if circle.center.distance(end) < 0.001
        )),
        "radial handle follows the resized ring"
    );
    let idle = frame(&ctx, &mut map, vec![], false);
    assert!(std::sync::Arc::ptr_eq(
        preview,
        idle.geometry_preview.as_ref().unwrap()
    ));
    let released = frame(&ctx, &mut map, vec![button(end, false)], false);
    assert!(released.geometry_preview.is_none());
    let Some(StreetEdit::Update(0, StreetChange::Radius(radius))) = released.street_edit else {
        panic!("release commits the live radius");
    };
    assert!((radius - 4.0).abs() < 0.001);
}

#[test]
fn straight_endpoint_drag_commits_geometry_without_panning_at_each_zoom() {
    use ca_core::streets::{StreetChange, StreetEdit};
    for zoom in [0.25_f32, 1.0, 4.0] {
        let mut document = ca_core::map_json::MapDocument::parse(
            r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":6,"x":25,"y":25}]}"#,
        )
        .unwrap();
        let ctx = egui::Context::default();
        let mut map = MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["A".into()]);
        map.configure(&document, [2.0, 1.0]);
        map.select(Some(0));
        frame(&ctx, &mut map, vec![], false);
        let p = map.camera().unwrap().world_to_screen([13.0, 6.0]);
        let start = egui::pos2(p[0], p[1]);
        frame(
            &ctx,
            &mut map,
            vec![egui::Event::PointerMoved(start), egui::Event::Zoom(zoom)],
            false,
        );
        let screen = |p| {
            let p = map.camera().unwrap().world_to_screen(p);
            egui::pos2(p[0], p[1])
        };
        let start = screen([13.0, 6.0]);
        let end = screen([15.0, 6.0]);
        let before = map.camera().unwrap().view();
        let button = |pos, pressed| egui::Event::PointerButton {
            pos,
            pressed,
            button: egui::PointerButton::Primary,
            modifiers: Default::default(),
        };
        let press = frame(
            &ctx,
            &mut map,
            vec![egui::Event::PointerMoved(start), button(start, true)],
            false,
        );
        assert!(press.structural_edit);
        frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
        let released = frame(&ctx, &mut map, vec![button(end, false)], false);
        assert_eq!(map.camera().unwrap().view(), before);
        let Some(StreetEdit::Update(
            0,
            StreetChange::StraightGeometry {
                origin,
                angle,
                length,
            },
        )) = released.street_edit
        else {
            panic!("endpoint must commit one geometry edit");
        };
        assert!((origin[0] - 5.0).abs() < 0.001 && (origin[1] - 5.0).abs() < 0.001);
        assert!(angle.abs() < 0.001);
        assert_eq!(length, 8);
        document
            .edit_streets(StreetEdit::Update(
                0,
                StreetChange::StraightGeometry {
                    origin,
                    angle,
                    length,
                },
            ))
            .unwrap();
        map.configure(&document, [2.0, 1.0]);
        let target = screen_position(&map, [14.5, 6.5]);
        let result = frame(
            &ctx,
            &mut map,
            vec![egui::Event::PointerMoved(target)],
            false,
        );
        assert_eq!(result.preview.unwrap().cell.index, 7);
    }
}

fn screen_position(map: &MapInteraction, point: [f32; 2]) -> egui::Pos2 {
    let p = map.camera().unwrap().world_to_screen(point);
    egui::pos2(p[0], p[1])
}

#[test]
fn selected_bodies_and_roundabout_center_move_without_pan() {
    use ca_core::{
        bezier::BezierChange,
        map_json::MapDocument,
        streets::{StreetChange, StreetEdit},
    };
    for kind in ["straight", "bezier", "roundabout"] {
        let mut document = MapDocument::parse(if kind == "roundabout" {
            r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":16,"geometryType":"roundabout","innerRadius":10,"startAngle":0,"x":50,"y":50}]}"#
        } else {
            r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":12,"x":25,"y":25}]}"#
        }).unwrap();
        if kind == "bezier" {
            document
                .edit_streets(StreetEdit::Update(
                    0,
                    StreetChange::Bezier(BezierChange::Convert),
                ))
                .unwrap();
        }
        for center in [false, true] {
            if center && kind != "roundabout" {
                continue;
            }
            let ctx = egui::Context::default();
            let mut map = MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["A".into()]);
            map.configure(&document, [2.0, 1.0]);
            map.select(Some(0));
            frame(&ctx, &mut map, vec![], false);
            let world = if center {
                [12.0, 11.0]
            } else {
                let index = if kind == "roundabout" { 5 } else { 2 };
                let p = document.geometry()[0].centers[0][index];
                [p[0] + 2.0, p[1] + 1.0]
            };
            if center {
                let anchor = screen_position(&map, world);
                frame(
                    &ctx,
                    &mut map,
                    vec![egui::Event::PointerMoved(anchor), egui::Event::Zoom(0.25)],
                    false,
                );
            }
            let start = screen_position(&map, world);
            let end = screen_position(&map, [world[0] + 2.0, world[1] + 3.0]);
            let before = map.camera().unwrap().view();
            let button = |pos, pressed| egui::Event::PointerButton {
                pos,
                pressed,
                button: egui::PointerButton::Primary,
                modifiers: Default::default(),
            };
            frame(
                &ctx,
                &mut map,
                vec![egui::Event::PointerMoved(start), button(start, true)],
                false,
            );
            let (moved, output) =
                painted_frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
            assert!(moved.structural_edit, "{kind} body/center drag must pause");
            assert!(moved.street_edit.is_none());
            let preview = moved
                .geometry_preview
                .as_ref()
                .expect("body moves during input");
            let old = document.geometry()[0].centers[0][0];
            let live = preview.geometry.centers[0][0];
            assert!((live[0] - old[0] - 4.0).abs() < 0.001);
            assert!((live[1] - old[1] - 4.0).abs() < 0.001);
            let origin = document.layout()[0].origin;
            let live_anchor =
                screen_position(&map, [origin[0] as f32 + 4.0, origin[1] as f32 + 4.0]);
            assert!(
                output.shapes.iter().any(|s| matches!(&s.shape,
                    egui::Shape::Circle(circle) if circle.center.distance(live_anchor) < 0.001
                )),
                "{kind} handles follow the body preview"
            );
            let released = frame(&ctx, &mut map, vec![button(end, false)], false);
            assert_eq!(map.camera().unwrap().view(), before);
            let Some(StreetEdit::Update(0, StreetChange::Origin(origin))) = released.street_edit
            else {
                panic!("{kind} must commit a translated origin");
            };
            let expected = if kind == "roundabout" {
                [12.0, 13.0]
            } else {
                [7.0, 8.0]
            };
            assert!((origin[0] - expected[0]).abs() < 0.001);
            assert!((origin[1] - expected[1]).abs() < 0.001);
            let mut edited = document.clone();
            edited
                .edit_streets(StreetEdit::Update(0, StreetChange::Origin(origin)))
                .unwrap();
            let old = document.geometry()[0].centers[0][0];
            let new = edited.geometry()[0].centers[0][0];
            assert!((new[0] - old[0] - 2.0).abs() < 0.001);
            assert!((new[1] - old[1] - 3.0).abs() < 0.001);
            map.configure(&edited, [2.0, 1.0]);
            let target = screen_position(&map, [new[0] + 2.0, new[1] + 1.0]);
            let hit = frame(
                &ctx,
                &mut map,
                vec![egui::Event::PointerMoved(target)],
                false,
            );
            assert_eq!(hit.preview.unwrap().cell.index, 0);
        }
    }
}

#[test]
fn invalid_endpoint_drag_is_rejected_with_a_persistent_translated_reason() {
    let document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":6,"x":25,"y":25}]}"#,
    )
    .unwrap();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["A".into()]);
    map.configure(&document, [0.0; 2]);
    map.select(Some(0));
    frame(&ctx, &mut map, vec![], false);
    let start = screen_position(&map, [11.0, 5.0]);
    let end = screen_position(&map, [5.2, 5.0]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: Default::default(),
    };
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    let released = frame(&ctx, &mut map, vec![button(end, false)], false);
    assert!(released.street_edit.is_none());
    let error = released.geometry_error.unwrap();
    assert_eq!(error.translation_key(), "streetInspector.errors.length");
    let shell = ca_app::shell::Shell::load(None);
    let reason = ca_app::inspector::geometry_error_message(&shell, error);
    assert!(!reason.is_empty() && reason != error.translation_key());
    let next = frame(&ctx, &mut map, vec![], false);
    assert_eq!(
        next.geometry_error,
        Some(error),
        "rejection must remain readable after release"
    );
    let restarted = frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    assert!(restarted.geometry_error.is_none());
}

#[test]
fn active_drawing_tools_block_pan_even_when_pressing_an_existing_street() {
    let document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":12,"x":25,"y":25}]}"#,
    )
    .unwrap();
    for roundabout in [false, true] {
        let ctx = egui::Context::default();
        let mut map = MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["A".into()]);
        map.configure(&document, [0.0; 2]);
        map.select(Some(0));
        if roundabout {
            map.set_roundabout_drawing(true);
        } else {
            map.set_drawing(true);
        }
        frame(&ctx, &mut map, vec![], false);
        let start = screen_position(&map, [8.5, 5.5]);
        let end = start + egui::vec2(60.0, 40.0);
        let before = map.camera().unwrap().view();
        let button = |pos, pressed| egui::Event::PointerButton {
            pos,
            pressed,
            button: egui::PointerButton::Primary,
            modifiers: Default::default(),
        };
        frame(
            &ctx,
            &mut map,
            vec![egui::Event::PointerMoved(start), button(start, true)],
            false,
        );
        frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
        let released = frame(&ctx, &mut map, vec![button(end, false)], false);
        assert_eq!(map.camera().unwrap().view(), before);
        assert!(released.street_edit.is_none());
    }
}

#[test]
fn losing_focus_cancels_a_radius_drag() {
    let document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":22,"geometryType":"roundabout","innerRadius":15,"startAngle":0,"x":50,"y":50}]}"#,
    ).unwrap();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["A".into()]);
    map.configure(&document, [0.0; 2]);
    map.select(Some(0));
    frame(&ctx, &mut map, vec![], false);
    let start = screen_position(&map, [13.0, 10.0]);
    let end = screen_position(&map, [15.0, 10.0]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: Default::default(),
    };
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    let cancelled = frame(
        &ctx,
        &mut map,
        vec![egui::Event::WindowFocused(false)],
        false,
    );
    assert!(!cancelled.structural_edit);
    assert!(cancelled.roundabout_preview.is_none());
    let released = frame(&ctx, &mut map, vec![button(end, false)], false);
    assert!(released.street_edit.is_none());
}

#[test]
fn ctrl_click_clears_selection_without_starting_either_drawing_tool() {
    let document = ca_core::map_json::MapDocument::parse(
        r#"{"calles":[
        {"nombre":"A","tipo":"conexion","tamano":6}
    ]}"#,
    )
    .unwrap();
    for roundabout in [false, true] {
        let ctx = egui::Context::default();
        let mut map = MapInteraction::new([20.0, 12.0], &document.geometry(), vec!["A".into()]);
        map.configure(&document, [0.0; 2]);
        map.select(Some(0));
        if roundabout {
            map.set_roundabout_drawing(true);
        } else {
            map.set_drawing(true);
        }
        frame(&ctx, &mut map, vec![], false);
        let p = map.camera().unwrap().world_to_screen([12.0, 8.0]);
        let pos = egui::pos2(p[0], p[1]);
        for pressed in [true, false] {
            let result = frame(
                &ctx,
                &mut map,
                vec![
                    egui::Event::PointerMoved(pos),
                    egui::Event::PointerButton {
                        pos,
                        pressed,
                        button: egui::PointerButton::Primary,
                        modifiers: egui::Modifiers::CTRL,
                    },
                ],
                false,
            );
            assert!(!result.structural_edit);
            assert!(result.street_preview.is_none() && result.roundabout_preview.is_none());
            assert!(result.street_edit.is_none() && result.clicked.is_none());
        }
        assert_eq!(map.selected(), None);
        assert!(map.drawing(), "selection must not cancel the drawing tool");
    }
}

#[test]
fn ctrl_click_on_selected_geometry_handles_does_not_start_an_edit() {
    use ca_core::{
        bezier::BezierChange,
        map_json::MapDocument,
        streets::{StreetChange, StreetEdit},
    };
    let mut curve = MapDocument::parse(
        r#"{"calles":[{
        "nombre":"Curve","tipo":"conexion","tamano":10,"x":25,"y":25
    }]}"#,
    )
    .unwrap();
    curve
        .edit_streets(StreetEdit::Update(
            0,
            StreetChange::Bezier(BezierChange::Convert),
        ))
        .unwrap();
    let ring = MapDocument::parse(
        r#"{"calles":[{
        "nombre":"Ring","tipo":"conexion","geometryType":"roundabout","tamano":16,
        "x":50,"y":50,"innerRadius":10,"startAngle":0
    }]}"#,
    )
    .unwrap();
    for (document, point) in [(curve, [10.0, 5.0]), (ring, [12.0, 10.0])] {
        let ctx = egui::Context::default();
        let mut map =
            MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["Street".into()]);
        map.configure(&document, [0.0; 2]);
        map.select(Some(0));
        frame(&ctx, &mut map, vec![], false);
        let p = map.camera().unwrap().world_to_screen(point);
        let pos = egui::pos2(p[0], p[1]);
        for pressed in [true, false] {
            let result = frame(
                &ctx,
                &mut map,
                vec![
                    egui::Event::PointerMoved(pos),
                    egui::Event::PointerButton {
                        pos,
                        pressed,
                        button: egui::PointerButton::Primary,
                        modifiers: egui::Modifiers::CTRL,
                    },
                ],
                false,
            );
            assert!(!result.structural_edit);
            assert!(result.street_edit.is_none());
            assert!(result.clicked.is_none());
            assert!(result.geometry_preview.is_none());
        }
    }
}

#[test]
fn only_ctrl_click_changes_the_map_street_selection_and_never_edits_a_cell() {
    use ca_core::{cell_index::CellRef, map_json::MapDocument};
    let document = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"A","tipo":"conexion","tamano":6},
        {"nombre":"B","tipo":"conexion","tamano":6,"y":20}
    ]}"#,
    )
    .unwrap();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new(
        [20.0, 12.0],
        &document.geometry(),
        vec!["A".into(), "B".into()],
    );
    map.configure(&document, [0.0; 2]);
    frame(&ctx, &mut map, vec![], false);
    let screen = |p: [f32; 2]| {
        let p = map.camera().unwrap().world_to_screen(p);
        egui::pos2(p[0], p[1])
    };
    let a = screen([2.5, 0.5]);
    let b = screen([2.5, 4.5]);
    let empty = screen([12.0, 8.0]);
    for (pos, ctrl, selected, clicked) in [
        (
            a,
            false,
            None,
            Some(CellRef {
                street: 0,
                lane: 0,
                index: 2,
            }),
        ),
        (a, true, Some(0), None),
        (
            b,
            false,
            Some(0),
            Some(CellRef {
                street: 1,
                lane: 0,
                index: 2,
            }),
        ),
        (empty, false, Some(0), None),
        (b, true, Some(1), None),
        (empty, true, None, None),
    ] {
        let button = |pressed| egui::Event::PointerButton {
            pos,
            pressed,
            button: egui::PointerButton::Primary,
            modifiers: egui::Modifiers {
                ctrl,
                ..Default::default()
            },
        };
        frame(
            &ctx,
            &mut map,
            vec![egui::Event::PointerMoved(pos), button(true)],
            false,
        );
        let released = frame(&ctx, &mut map, vec![button(false)], false);
        assert_eq!(map.selected(), selected);
        assert_eq!(released.clicked, clicked);
        assert!(released.street_edit.is_none());
    }
}

#[test]
fn unsampleable_candidates_keep_live_red_guides_without_changing_the_map() {
    use ca_core::map_json::MapDocument;
    let controls: Vec<_> = (1..=32)
        .map(|i| serde_json::json!({"x":i as f64*50.0/33.0,"y":0}))
        .collect();
    let document = MapDocument::parse(
        &serde_json::json!({"calles":[{
            "nombre":"Curve","tipo":"conexion","tamano":10,"bezierGeometry":true,
            "bezierControls":controls,"endX":50,"endY":0
        }]})
        .to_string(),
    )
    .unwrap();
    let saved = document.to_json();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([2000.0, 2000.0], &document.geometry(), vec!["Curve".into()]);
    map.configure(&document, [0.0; 2]);
    map.select(Some(0));
    frame(&ctx, &mut map, vec![], false);
    let screen = |p: [f32; 2]| {
        let p = map.camera().unwrap().world_to_screen(p);
        egui::pos2(p[0], p[1])
    };
    let point =
        document.layout()[0].bezier.as_ref().unwrap().sections()[0].controls[31].map(|v| v as f32);
    let start = screen(point);
    let end = screen([1000.0, 1000.0]);
    frame(
        &ctx,
        &mut map,
        vec![
            egui::Event::PointerMoved(start),
            egui::Event::PointerButton {
                pos: start,
                pressed: true,
                button: egui::PointerButton::Primary,
                modifiers: egui::Modifiers::NONE,
            },
        ],
        false,
    );
    let (moving, output) =
        painted_frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    assert_eq!(
        moving.geometry_error.unwrap().translation_key(),
        "bezier.invalidControls"
    );
    assert!(
        moving.geometry_preview.is_none(),
        "sampling budget prevents a cell mesh"
    );
    assert!(
        output.shapes.iter().any(|s| matches!(&s.shape,
        egui::Shape::LineSegment {points,stroke} if stroke.color == egui::Color32::RED
            && points.iter().any(|p| p.distance(end)<0.001))),
        "invalid guides still follow the pointer"
    );
    assert!(output.shapes.iter().any(|s| matches!(&s.shape,
        egui::Shape::Circle(circle) if circle.fill == egui::Color32::RED && circle.center.distance(end)<0.001)));
    assert_eq!(document.to_json(), saved);
}

#[test]
fn cancelling_or_releasing_an_invalid_curve_preview_keeps_the_original_map() {
    use ca_core::{
        bezier::BezierChange,
        map_json::MapDocument,
        streets::{StreetChange, StreetEdit},
    };
    let mut document = MapDocument::parse(
        r#"{"calles":[{
        "nombre":"Curve","tipo":"conexion","tamano":10,"carriles":2,"x":25,"y":25
    }]}"#,
    )
    .unwrap();
    document
        .edit_streets(StreetEdit::Update(
            0,
            StreetChange::Bezier(BezierChange::Convert),
        ))
        .unwrap();
    let saved = document.to_json();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 100.0], &document.geometry(), vec!["Curve".into()]);
    map.configure(&document, [0.0; 2]);
    map.select(Some(0));
    frame(&ctx, &mut map, vec![], false);
    let screen = |p: [f32; 2]| {
        let p = map.camera().unwrap().world_to_screen(p);
        egui::pos2(p[0], p[1])
    };
    let start = screen([10.0, 5.0]);
    let ends = [
        screen([10.0, 8.0]),
        screen([10.0, 8.0]),
        screen([10.0, 45.0]),
    ];
    let before = map.camera().unwrap().view();
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    for (case, end) in (0..3).zip(ends) {
        let invalid = case == 2;
        frame(
            &ctx,
            &mut map,
            vec![egui::Event::PointerMoved(start), button(start, true)],
            false,
        );
        let (moving, output) =
            painted_frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
        let preview = moving.geometry_preview.as_ref().unwrap();
        assert_eq!(moving.view, before);
        assert_eq!(moving.geometry_error.is_some(), invalid);
        let idle = frame(&ctx, &mut map, vec![], false);
        assert!(
            std::sync::Arc::ptr_eq(preview, idle.geometry_preview.as_ref().unwrap()),
            "an unchanged pointer reuses the sampled preview"
        );
        if invalid {
            assert_eq!(preview.error.unwrap().translation_key(), "bezier.overlap");
            assert!(output.shapes.iter().any(|s| matches!(&s.shape,
                egui::Shape::Mesh(mesh) if mesh.vertices.iter().any(|v| v.color == egui::Color32::RED))));
        } else {
            let cancelled = frame(
                &ctx,
                &mut map,
                vec![if case == 0 {
                    egui::Event::Key {
                        key: egui::Key::Escape,
                        physical_key: None,
                        pressed: true,
                        repeat: false,
                        modifiers: egui::Modifiers::NONE,
                    }
                } else {
                    egui::Event::WindowFocused(false)
                }],
                false,
            );
            assert!(cancelled.geometry_preview.is_none());
            assert!(cancelled.street_edit.is_none());
        }
        let released = frame(&ctx, &mut map, vec![button(end, false)], false);
        assert!(released.geometry_preview.is_none());
        assert!(released.street_edit.is_none());
        assert_eq!(document.to_json(), saved);
    }
}

#[test]
fn bezier_drag_previews_the_shape_and_guides_before_committing() {
    use ca_core::{
        bezier::BezierChange,
        map_json::MapDocument,
        streets::{StreetChange, StreetEdit},
    };
    let mut document = MapDocument::parse(
        r#"{"calles":[{
        "nombre":"Curve","tipo":"conexion","tamano":10,"x":25,"y":25
    }]}"#,
    )
    .unwrap();
    document
        .edit_streets(StreetEdit::Update(
            0,
            StreetChange::Bezier(BezierChange::Convert),
        ))
        .unwrap();
    let saved = document.to_json();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["Curve".into()]);
    map.configure(&document, [2.0, 3.0]);
    map.select(Some(0));
    frame(&ctx, &mut map, vec![], false);
    let screen = |p: [f32; 2]| {
        let p = map.camera().unwrap().world_to_screen(p);
        egui::pos2(p[0], p[1])
    };
    let start = screen([12.0, 8.0]);
    let end = screen([12.0, 11.0]);
    let anchor = screen([7.0, 8.0]);
    let button = |pressed| egui::Event::PointerButton {
        pos: if pressed { start } else { end },
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(true)],
        false,
    );
    let before = map.camera().unwrap().view();
    let (moving, output) =
        painted_frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    assert_eq!(moving.view, before);
    assert!(
        moving.street_edit.is_none(),
        "preview must not commit an edit"
    );
    let preview = moving
        .geometry_preview
        .as_ref()
        .expect("live curve preview");
    assert_eq!(preview.street, 0);
    assert!(preview.error.is_none());
    let highest = preview.geometry.centers[0]
        .iter()
        .map(|p| p[1])
        .fold(f32::NEG_INFINITY, f32::max);
    assert!(
        (9.45..=9.5).contains(&highest),
        "quadratic midpoint is at y=6.5 plus display shift"
    );
    assert_eq!(document.to_json(), saved);
    assert!(
        output.shapes.iter().any(|s| matches!(&s.shape,
        egui::Shape::LineSegment { points,.. }
            if points[0].distance(anchor)<0.001 && points[1].distance(end)<0.001)),
        "guide follows the dragged control"
    );
    assert!(
        output.shapes.iter().any(|s| matches!(&s.shape,
        egui::Shape::Mesh(mesh) if !mesh.indices.is_empty())),
        "preview draws cell footprints before mouse release"
    );
    let released = frame(&ctx, &mut map, vec![button(false)], false);
    assert!(released.geometry_preview.is_none());
    document
        .edit_streets(released.street_edit.unwrap())
        .unwrap();
    let mut committed = document.geometry_snapshot();
    committed.translate([2.0, 3.0]);
    assert_eq!(preview.geometry.centers, committed.streets[0].centers);
}

#[test]
fn bezier_controls_drag_without_panning_and_delete_keeps_the_street() {
    use ca_core::{
        bezier::{BezierChange, CurvePoint},
        map_json::MapDocument,
        streets::{StreetChange, StreetEdit},
    };
    let mut document = MapDocument::parse(
        r#"{"calles":[{
        "nombre":"Curve","tipo":"conexion","tamano":10,"x":25,"y":25
    }]}"#,
    )
    .unwrap();
    document
        .edit_streets(StreetEdit::Update(
            0,
            StreetChange::Bezier(BezierChange::Convert),
        ))
        .unwrap();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["Curve".into()]);
    map.configure(&document, [0.0; 2]);
    map.select(Some(0));
    frame(&ctx, &mut map, vec![], false);
    let screen = |p: [f32; 2]| {
        let p = map.camera().unwrap().world_to_screen(p);
        egui::pos2(p[0], p[1])
    };
    let start = screen([10.0, 5.0]);
    let end = screen([10.0, 8.0]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    let before = map.camera().unwrap().view();
    let pressed = frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    assert!(pressed.structural_edit);
    frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    let released = frame(&ctx, &mut map, vec![button(end, false)], false);
    assert_eq!(released.view, before);
    assert!(released.clicked.is_none());
    let Some(StreetEdit::Update(
        0,
        StreetChange::Bezier(BezierChange::Move(CurvePoint::Control(0, 0), point)),
    )) = released.street_edit
    else {
        panic!("expected control edit");
    };
    assert!((point[0] - 10.0).abs() < 0.00001 && (point[1] - 8.0).abs() < 0.00001);
    let deleted = frame(
        &ctx,
        &mut map,
        vec![egui::Event::Key {
            key: egui::Key::Delete,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers: egui::Modifiers::NONE,
        }],
        false,
    );
    assert_eq!(
        deleted.street_edit,
        Some(StreetEdit::Update(
            0,
            StreetChange::Bezier(BezierChange::Remove(CurvePoint::Control(0, 0)))
        ))
    );
    document.edit_streets(deleted.street_edit.unwrap()).unwrap();
    assert_eq!(document.layout().len(), 1);
    assert!(
        document.layout()[0].bezier.as_ref().unwrap().sections()[0]
            .controls
            .is_empty()
    );
}

#[test]
fn roundabout_drag_previews_radius_and_commits_without_panning() {
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 20.0], &[], vec![]);
    frame(&ctx, &mut map, vec![], false);
    map.set_roundabout_drawing(true);
    let camera = map.camera().unwrap();
    let a = camera.world_to_screen([10.0, 10.0]);
    let b = camera.world_to_screen([12.0, 10.0]);
    let start = egui::pos2(a[0], a[1]);
    let end = egui::pos2(b[0], b[1]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    let before = map.camera().unwrap().view();
    let invalid = frame(&ctx, &mut map, vec![], false);
    assert!(invalid.geometry_error.is_some());
    let preview = frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    assert_eq!(preview.view, before);
    assert_eq!(preview.roundabout_preview.unwrap().cells(), 16);
    assert!((preview.roundabout_preview.unwrap().inner_radius - 2.0).abs() < 0.00001);
    let committed = frame(&ctx, &mut map, vec![button(end, false)], false);
    assert!(matches!(
        committed.street_edit,
        Some(ca_core::streets::StreetEdit::DrawRoundabout(_))
    ));
    assert!(committed.clicked.is_none());
    assert!(!map.drawing());
}

#[test]
fn selected_roundabout_radial_handle_resizes_and_escape_cancels() {
    use ca_core::{
        map_json::MapDocument,
        streets::{RoundaboutDraft, StreetChange, StreetEdit},
    };
    let ctx = egui::Context::default();
    let mut document = MapDocument::empty();
    document
        .edit_streets(StreetEdit::DrawRoundabout(
            RoundaboutDraft::new([10.0, 10.0], 2.0, 0.0).unwrap(),
        ))
        .unwrap();
    let mut map = MapInteraction::new([30.0, 20.0], &document.geometry(), vec!["Ring".into()]);
    map.configure(&document, [0.0; 2]);
    map.select(Some(0));
    frame(&ctx, &mut map, vec![], false);
    let a = map.camera().unwrap().world_to_screen([12.0, 10.0]);
    let b = map.camera().unwrap().world_to_screen([14.0, 10.0]);
    let start = egui::pos2(a[0], a[1]);
    let end = egui::pos2(b[0], b[1]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    let before = map.camera().unwrap().view();
    for cancel in [true, false] {
        let started = frame(
            &ctx,
            &mut map,
            vec![egui::Event::PointerMoved(start), button(start, true)],
            false,
        );
        assert!(started.structural_edit);
        let preview = frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
        assert_eq!(preview.view, before);
        let geometry = &preview.geometry_preview.as_ref().unwrap().geometry;
        assert_eq!(geometry.centers[0].len(), 28);
        let p = geometry.centers[0][0];
        assert!(((p[0] - 10.0).hypot(p[1] - 10.0) - 4.5).abs() < 0.00001);
        if cancel {
            frame(
                &ctx,
                &mut map,
                vec![egui::Event::Key {
                    key: egui::Key::Escape,
                    physical_key: None,
                    pressed: true,
                    repeat: false,
                    modifiers: egui::Modifiers::NONE,
                }],
                false,
            );
        }
        let released = frame(&ctx, &mut map, vec![button(end, false)], false);
        if cancel {
            assert!(released.street_edit.is_none());
        } else {
            let Some(StreetEdit::Update(0, StreetChange::Radius(radius))) = released.street_edit
            else {
                panic!("radius edit");
            };
            assert!((radius - 4.0).abs() < 0.00001);
        }
        assert!(released.clicked.is_none());
    }
}

#[test]
fn drawing_previews_quantized_cells_cancels_and_commits_without_panning() {
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 20.0], &[], vec![]);
    frame(&ctx, &mut map, vec![], false);
    map.set_drawing(true);
    let camera = map.camera().unwrap();
    let a = camera.world_to_screen([4.0, 4.0]);
    let b = camera.world_to_screen([7.0, 8.0]);
    let start = egui::pos2(a[0], a[1]);
    let end = egui::pos2(b[0], b[1]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    let started = frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    assert!(started.structural_edit);
    let before = map.camera().unwrap().view();
    let preview = frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    assert_eq!(preview.view, before);
    assert_eq!(preview.street_preview.unwrap().cells, 5);
    let committed = frame(&ctx, &mut map, vec![button(end, false)], false);
    let ca_core::streets::StreetEdit::Draw(draft) = committed.street_edit.unwrap() else {
        panic!("draw");
    };
    assert_eq!(draft.cells, 5);
    assert!(committed.clicked.is_none());
    map.set_drawing(true);
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    let cancelled = frame(
        &ctx,
        &mut map,
        vec![egui::Event::Key {
            key: egui::Key::Escape,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers: egui::Modifiers::NONE,
        }],
        false,
    );
    assert!(cancelled.street_preview.is_none());
    assert_eq!(
        frame(
            &ctx,
            &mut map,
            vec![egui::Event::PointerMoved(end + egui::vec2(40.0, 0.0))],
            false
        )
        .view,
        before,
        "a cancelled drawing gesture must not become a pan"
    );
    assert!(
        frame(&ctx, &mut map, vec![button(end, false)], false)
            .street_edit
            .is_none()
    );
}

#[test]
fn deletion_uses_selection_and_refreshes_physical_cell_picks() {
    use ca_core::{map_json::MapDocument, streets::StreetEdit};
    let ctx = egui::Context::default();
    let mut document = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"Removed","tipo":"conexion","tamano":4,"x":0,"y":0},
        {"nombre":"Kept","tipo":"conexion","tamano":4,"x":0,"y":20}
    ]}"#,
    )
    .unwrap();
    let mut map = MapInteraction::new(
        [10.0, 10.0],
        &document.geometry(),
        vec!["Removed".into(), "Kept".into()],
    );
    map.configure(&document, [0.0; 2]);
    frame(&ctx, &mut map, vec![], false);
    let a = map.camera().unwrap().world_to_screen([1.5, 0.5]);
    let pos = egui::pos2(a[0], a[1]);
    let button = |pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::CTRL,
    };
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(pos), button(true)],
        false,
    );
    frame(&ctx, &mut map, vec![button(false)], false);
    assert_eq!(map.selected(), Some(0));
    let deletion = frame(
        &ctx,
        &mut map,
        vec![egui::Event::Key {
            key: egui::Key::Delete,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers: egui::Modifiers::NONE,
        }],
        false,
    )
    .street_edit;
    assert_eq!(deletion, Some(StreetEdit::Delete(0)));
    document.edit_streets(deletion.unwrap()).unwrap();
    map.configure(&document, [0.0; 2]);
    map.select(None);
    assert!(
        frame(&ctx, &mut map, vec![egui::Event::PointerMoved(pos)], true)
            .preview
            .is_none()
    );
    let kept = map.camera().unwrap().world_to_screen([1.5, 4.5]);
    let hovered = frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(egui::pos2(kept[0], kept[1]))],
        true,
    );
    assert_eq!(hovered.tooltip.as_deref(), Some("Kept : 1"));
    assert_eq!(hovered.preview.unwrap().cell.street, 0);
}

#[test]
fn new_street_bounds_remain_reachable_after_zooming_in() {
    use ca_core::{map_json::MapDocument, streets::StreetDraft};
    let ctx = egui::Context::default();
    let mut document = MapDocument::empty();
    let mut map = MapInteraction::new([5.0, 5.0], &[], vec![]);
    frame(&ctx, &mut map, vec![], false);
    document
        .draw_street(StreetDraft::between([-20.0, 0.0], [40.0, 0.0]).unwrap())
        .unwrap();
    let before = map.camera().unwrap().view();
    map.configure(&document, [0.0; 2]);
    assert_eq!(
        map.camera().unwrap().view(),
        before,
        "topology must not reset the view"
    );
    let center = egui::pos2(360.0, 140.0);
    frame(
        &ctx,
        &mut map,
        vec![
            egui::Event::PointerMoved(center),
            egui::Event::Zoom(4.0),
            egui::Event::MouseWheel {
                unit: egui::MouseWheelUnit::Point,
                delta: egui::vec2(-100000.0, 0.0),
                modifiers: egui::Modifiers::NONE,
            },
        ],
        false,
    );
    let view = map.camera().unwrap().view();
    assert!(
        view.origin[0] + view.span[0] > 39.0,
        "new far endpoint must stay reachable"
    );
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::MouseWheel {
            unit: egui::MouseWheelUnit::Point,
            delta: egui::vec2(100000.0, 0.0),
            modifiers: egui::Modifiers::NONE,
        }],
        false,
    );
    assert!(
        map.camera().unwrap().view().origin[0] < -19.0,
        "negative new endpoint must stay reachable"
    );
}

#[test]
fn draw_mode_does_not_start_on_an_existing_street_or_a_short_drag() {
    use ca_core::cell_index::StreetGeometry;
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new(
        [30.0, 20.0],
        &[StreetGeometry {
            id: 0,
            centers: vec![vec![[4.5, 4.5]]],
        }],
        vec!["Existing".into()],
    );
    frame(&ctx, &mut map, vec![], false);
    for start in [[4.5, 4.5], [8.0, 8.0]] {
        map.set_drawing(true);
        let a = map.camera().unwrap().world_to_screen(start);
        let start = egui::pos2(a[0], a[1]);
        let end = start + egui::vec2(2.0, 0.0);
        let button = |pos, pressed| egui::Event::PointerButton {
            pos,
            pressed,
            button: egui::PointerButton::Primary,
            modifiers: egui::Modifiers::NONE,
        };
        frame(
            &ctx,
            &mut map,
            vec![egui::Event::PointerMoved(start), button(start, true)],
            false,
        );
        assert!(
            frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false)
                .street_preview
                .is_none()
        );
        assert!(
            frame(&ctx, &mut map, vec![button(end, false)], false)
                .street_edit
                .is_none()
        );
    }
}

fn frame(
    ctx: &egui::Context,
    map: &mut MapInteraction,
    events: Vec<egui::Event>,
    detect: bool,
) -> ca_app::map::MapFrame {
    painted_frame(ctx, map, events, detect).0
}

fn painted_frame(
    ctx: &egui::Context,
    map: &mut MapInteraction,
    events: Vec<egui::Event>,
    detect: bool,
) -> (ca_app::map::MapFrame, egui::FullOutput) {
    let modifiers = events
        .iter()
        .rev()
        .find_map(|event| match event {
            egui::Event::PointerButton { modifiers, .. } | egui::Event::Key { modifiers, .. } => {
                Some(*modifiers)
            }
            _ => None,
        })
        .unwrap_or_default();
    let mut result = None;
    let output = ctx.run(
        egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(720.0, 280.0),
            )),
            events,
            modifiers,
            ..Default::default()
        },
        |ctx| {
            egui::CentralPanel::default()
                .frame(egui::Frame::NONE)
                .show(ctx, |ui| {
                    let frame = map.show(ui, detect);
                    frame.paint_preview(ui.painter());
                    map.paint_vertices(ui.painter(), frame.rect);
                    result = Some(frame);
                });
        },
    );
    (result.unwrap(), output)
}

#[test]
fn z_mode_drag_reshapes_a_street_without_panning_or_placing_a_vehicle() {
    use ca_core::map_json::MapDocument;
    let mut document = MapDocument::parse(
        r#"{"calles":[{"nombre":"Road","tipo":"conexion","tamano":21,"carriles":1}]}"#,
    )
    .unwrap();
    let scene = ca_gpu::TrafficScene::from_document(&document);
    let shift = scene.shift();
    let mut map = MapInteraction::new(
        scene.extent().map(|v| v as f32),
        &scene.geometry(),
        scene.street_names(),
    );
    map.configure(&document, shift);
    let ctx = egui::Context::default();
    frame(&ctx, &mut map, vec![], false);
    let z = egui::Event::Key {
        key: egui::Key::Z,
        physical_key: None,
        pressed: true,
        repeat: false,
        modifiers: egui::Modifiers::NONE,
    };
    assert!(frame(&ctx, &mut map, vec![z], false).vertex_mode);
    let position = map
        .camera()
        .unwrap()
        .world_to_screen([10.5 + shift[0], 0.5 + shift[1]]);
    let start = egui::pos2(position[0], position[1]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    let select = |pressed| egui::Event::PointerButton {
        pos: start,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::CTRL,
    };
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    let (plain, output) = painted_frame(&ctx, &mut map, vec![button(start, false)], false);
    assert_eq!(map.selected(), None);
    assert!(
        plain.clicked.is_none(),
        "vertex mode never edits vehicle cells"
    );
    assert!(
        !output
            .shapes
            .iter()
            .any(|s| matches!(&s.shape, egui::Shape::Circle(_))),
        "a normal click must not select the vertex editor's street"
    );
    // Ctrl+click selects the street; an ordinary drag then moves its handle.
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), select(true)],
        false,
    );
    assert!(
        frame(&ctx, &mut map, vec![select(false)], false)
            .clicked
            .is_none()
    );
    frame(&ctx, &mut map, vec![button(start, true)], false);
    let before = map.camera().unwrap().view();
    let end = start + egui::vec2(0.0, 60.0);
    let dragged = frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], false);
    assert_eq!(dragged.view, before);
    let edit = dragged.vertex_edit.expect("handle drag");
    assert_eq!((edit.street, edit.vertex), (0, 1));
    assert!((edit.offset + 27.0).abs() < 0.001);
    assert!(document.set_vertex_offset(edit.street, edit.vertex, edit.offset));
    map.configure(&document, shift);
    assert!(
        frame(&ctx, &mut map, vec![], false).vertex_edit.is_none(),
        "stationary pointer must not compound an edit"
    );
    frame(&ctx, &mut map, vec![button(end, false)], false);
    let moved = document.geometry()[0].centers[0][10];
    assert!(moved[1] > 1.0);
    let location = map
        .camera()
        .unwrap()
        .world_to_screen([moved[0] + shift[0], moved[1] + shift[1]]);
    let hovered = frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(egui::pos2(
            location[0],
            location[1],
        ))],
        true,
    );
    assert_eq!(hovered.tooltip.as_deref(), Some("Road : 10"));
    let preview = hovered.preview.unwrap();
    assert!(
        (preview.corners[1].y - preview.corners[0].y).abs() > 1.0,
        "preview edge must follow the edited tangent"
    );
}

#[test]
fn a_floating_window_cannot_start_a_vertex_drag_below_it() {
    use ca_core::map_json::MapDocument;
    let document = MapDocument::parse(
        r#"{"calles":[{"nombre":"Road","tipo":"conexion","tamano":21,"carriles":1}]}"#,
    )
    .unwrap();
    let scene = ca_gpu::TrafficScene::from_document(&document);
    let mut map = MapInteraction::new(
        scene.extent().map(|v| v as f32),
        &scene.geometry(),
        scene.street_names(),
    );
    map.configure(&document, scene.shift());
    let ctx = egui::Context::default();
    frame(&ctx, &mut map, vec![], false);
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::Key {
            key: egui::Key::Z,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers: egui::Modifiers::NONE,
        }],
        false,
    );
    let p = map.camera().unwrap().world_to_screen([12.5, 2.5]);
    let start = egui::pos2(p[0], p[1]);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    let select = |pressed| egui::Event::PointerButton {
        pos: start,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::CTRL,
    };
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), select(true)],
        false,
    );
    frame(&ctx, &mut map, vec![select(false)], false);
    let before = map.camera().unwrap().view();
    for events in [
        vec![],
        vec![button(start, true)],
        vec![egui::Event::PointerMoved(start + egui::vec2(0.0, 40.0))],
    ] {
        let mut result = None;
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(720.0, 280.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                egui::Window::new("Profiler")
                    .fixed_pos(start - egui::vec2(40.0, 40.0))
                    .fixed_size(egui::vec2(160.0, 120.0))
                    .title_bar(false)
                    .show(ctx, |ui| {
                        ui.label("Overlay");
                    });
                egui::CentralPanel::default()
                    .frame(egui::Frame::NONE)
                    .show(ctx, |ui| {
                        result = Some(map.show(ui, false));
                    });
            },
        );
        let result = result.unwrap();
        assert!(
            result.vertex_edit.is_none(),
            "overlay pointer must not reach the vertex editor"
        );
        assert_eq!(result.view, before);
    }
}

#[test]
fn placement_preview_and_paused_click_share_the_cursor_target_in_an_offset_panel() {
    let scene = ca_gpu::TrafficScene::demo();
    let mut map = MapInteraction::new(
        scene.extent().map(|v| v as f32),
        &scene.geometry(),
        scene.street_names(),
    );
    let ctx = egui::Context::default();
    let mut show = |events| {
        let mut result = None;
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1000.0, 600.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                egui::TopBottomPanel::top("toolbar")
                    .exact_height(60.0)
                    .frame(egui::Frame::NONE)
                    .show(ctx, |_| {});
                egui::SidePanel::left("sidebar")
                    .exact_width(280.0)
                    .frame(egui::Frame::NONE)
                    .show(ctx, |_| {});
                egui::CentralPanel::default()
                    .frame(egui::Frame::NONE)
                    .show(ctx, |ui| result = Some(map.show(ui, false)));
            },
        );
        result.unwrap()
    };
    show(vec![]);
    // Map is (280,60)..(1000,600), with 20 points per world unit and
    // vertical letterboxing. Empty cell (street 1, lane 0, index 8) has
    // world center (10.5,6.5), which is screen (490,320).
    let pos = egui::pos2(490.0, 320.0);
    let hover = show(vec![egui::Event::PointerMoved(pos)]);
    let preview = hover.preview.expect("show target even with detection off");
    assert_eq!(
        preview.cell,
        ca_core::cell_index::CellRef {
            street: 1,
            lane: 0,
            index: 8
        }
    );
    assert!((preview.rect.center() - pos).length() < 0.01);
    assert_eq!(preview.rect.size(), egui::vec2(20.0, 20.0));
    let button = |pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    show(vec![button(true)]);
    let clicked = show(vec![button(false)]);
    assert_eq!(clicked.clicked, Some(preview.cell));
    let mut scene = scene;
    assert!(scene.toggle_vehicle(clicked.clicked.unwrap(), true));
    assert_eq!(scene.cells()[72] & 255, 1);
    assert!(show(vec![egui::Event::PointerGone]).preview.is_none());
}

#[test]
fn hover_uses_physical_index_detection_setting_and_clicks_do_not_depend_on_detection() {
    let scene = ca_gpu::TrafficScene::demo();
    let mut map = MapInteraction::new(
        scene.extent().map(|v| v as f32),
        &scene.geometry(),
        scene.street_names(),
    );
    let ctx = egui::Context::default();
    frame(&ctx, &mut map, vec![], true);
    let pos = egui::pos2(150.0, 70.0); // world (7.5, 3.5), reverse lane, physical cell 5.
    let hover = frame(&ctx, &mut map, vec![egui::Event::PointerMoved(pos)], true);
    assert_eq!(hover.tooltip.as_deref(), Some("Generador : 5"));
    let hidden = frame(&ctx, &mut map, vec![], false);
    assert_eq!(hidden.tooltip, None);
    let button = |pressed| egui::Event::PointerButton {
        pos,
        button: egui::PointerButton::Primary,
        pressed,
        modifiers: egui::Modifiers::NONE,
    };
    frame(&ctx, &mut map, vec![button(true)], false);
    let clicked = frame(&ctx, &mut map, vec![button(false)], false);
    let cell = clicked
        .clicked
        .expect("click still edits with hover detection off");
    assert_eq!((cell.street, cell.lane, cell.index), (0, 1, 5));
}

#[test]
fn mouse_wheel_keeps_cursor_anchor_and_pixel_trackpad_pans() {
    let scene = ca_gpu::TrafficScene::demo();
    let mut map = MapInteraction::new(
        scene.extent().map(|v| v as f32),
        &scene.geometry(),
        scene.street_names(),
    );
    let ctx = egui::Context::default();
    let pos = egui::pos2(150.0, 70.0);
    frame(&ctx, &mut map, vec![egui::Event::PointerMoved(pos)], true);
    let zoomed = frame(
        &ctx,
        &mut map,
        vec![egui::Event::MouseWheel {
            unit: egui::MouseWheelUnit::Line,
            delta: egui::vec2(0.0, 4.0),
            modifiers: egui::Modifiers::NONE,
        }],
        true,
    );
    assert!(zoomed.view.span[0] < 36.0);
    assert!((zoomed.preview.unwrap().rect.center() - pos).length() < 0.001);
    let anchor = map.camera().unwrap().screen_to_world([150.0, 70.0]);
    assert!((anchor[0] - 7.5).abs() < 0.0001);
    assert!((anchor[1] - 3.5).abs() < 0.0001);
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::MouseWheel {
            unit: egui::MouseWheelUnit::Point,
            delta: egui::vec2(20.0, -10.0),
            modifiers: egui::Modifiers::NONE,
        }],
        true,
    );
    let moved = map.camera().unwrap().world_to_screen([7.5, 3.5]);
    assert!((moved[0] - 170.0).abs() < 0.0001);
    assert!((moved[1] - 60.0).abs() < 0.0001);
    let hovered = frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(egui::pos2(170.0, 60.0))],
        false,
    );
    let preview = hovered.preview.unwrap();
    assert_eq!(
        (preview.cell.street, preview.cell.lane, preview.cell.index),
        (0, 1, 5)
    );
    assert!((preview.rect.center() - egui::pos2(170.0, 60.0)).length() < 0.001);
}

#[test]
fn drag_pans_without_editing_a_road() {
    let scene = ca_gpu::TrafficScene::demo();
    let mut map = MapInteraction::new(
        scene.extent().map(|v| v as f32),
        &scene.geometry(),
        scene.street_names(),
    );
    let ctx = egui::Context::default();
    frame(&ctx, &mut map, vec![], true);
    let start = egui::pos2(150.0, 70.0);
    let end = egui::pos2(190.0, 90.0);
    frame(
        &ctx,
        &mut map,
        vec![
            egui::Event::PointerMoved(start),
            egui::Event::PointerButton {
                pos: start,
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::NONE,
            },
        ],
        true,
    );
    let dragged = frame(&ctx, &mut map, vec![egui::Event::PointerMoved(end)], true);
    assert_eq!(dragged.clicked, None);
    assert_eq!(dragged.tooltip, None);
    assert!(dragged.preview.is_none());
    assert!(dragged.view.origin[0] < 0.0);
    let released = frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerButton {
            pos: end,
            button: egui::PointerButton::Primary,
            pressed: false,
            modifiers: egui::Modifiers::NONE,
        }],
        true,
    );
    assert_eq!(released.clicked, None);
}

#[test]
fn two_finger_touch_pinches_and_pans_without_a_cell_click() {
    let scene = ca_gpu::TrafficScene::demo();
    let mut map = MapInteraction::new(
        scene.extent().map(|v| v as f32),
        &scene.geometry(),
        scene.street_names(),
    );
    let ctx = egui::Context::default();
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(egui::pos2(150.0, 70.0))],
        true,
    );
    let touch = |id, phase, x, y| egui::Event::Touch {
        device_id: egui::TouchDeviceId(1),
        id: egui::TouchId(id),
        phase,
        pos: egui::pos2(x, y),
        force: None,
    };
    frame(
        &ctx,
        &mut map,
        vec![
            egui::Event::PointerMoved(egui::pos2(150.0, 70.0)),
            egui::Event::PointerButton {
                pos: egui::pos2(150.0, 70.0),
                button: egui::PointerButton::Primary,
                pressed: true,
                modifiers: egui::Modifiers::NONE,
            },
            touch(1, egui::TouchPhase::Start, 130.0, 70.0),
            touch(2, egui::TouchPhase::Start, 170.0, 70.0),
        ],
        true,
    );
    let pinched = frame(
        &ctx,
        &mut map,
        vec![
            touch(1, egui::TouchPhase::Move, 110.0, 70.0),
            touch(2, egui::TouchPhase::Move, 190.0, 70.0),
        ],
        true,
    );
    assert!((pinched.view.span[0] - 18.0).abs() < 0.001);
    assert!(pinched.preview.is_none());
    let anchor = map.camera().unwrap().screen_to_world([150.0, 70.0]);
    assert!((anchor[0] - 7.5).abs() < 0.001);
    assert!((anchor[1] - 3.5).abs() < 0.001);
    frame(
        &ctx,
        &mut map,
        vec![
            touch(1, egui::TouchPhase::Move, 130.0, 80.0),
            touch(2, egui::TouchPhase::Move, 210.0, 80.0),
        ],
        true,
    );
    let moved = map.camera().unwrap().world_to_screen([7.5, 3.5]);
    assert!((moved[0] - 170.0).abs() < 0.001);
    assert!((moved[1] - 80.0).abs() < 0.001);
    let released = frame(
        &ctx,
        &mut map,
        vec![
            touch(1, egui::TouchPhase::End, 130.0, 80.0),
            touch(2, egui::TouchPhase::End, 210.0, 80.0),
            egui::Event::PointerButton {
                pos: egui::pos2(150.0, 70.0),
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::NONE,
            },
        ],
        true,
    );
    assert_eq!(released.clicked, None);
}
