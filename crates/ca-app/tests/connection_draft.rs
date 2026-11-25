use ca_app::connection_draft::{ConnectionDraft, DraftKind};
use ca_core::{connections::Connection, map_json::MapDocument};

fn document() -> MapDocument {
    MapDocument::parse(r#"{"calles":[
        {"nombre":"Source","tipo":"conexion","tamano":4,"carriles":2,"laneDirections":[1,-1],"x":25,"y":25},
        {"nombre":"Destination","tipo":"conexion","tamano":5,"carriles":2,"laneDirections":[-1,1],"x":75,"y":75}
    ]}"#).unwrap()
}

#[test]
fn cancel_keeps_live_links_and_merge_defaults_follow_each_lane_direction() {
    let mut doc = document();
    doc.add_connection(Connection::Lineal(ca_core::connections::Mapping {
        source_street: 0,
        source_lane: 0,
        source_cell: 2,
        destination_street: 1,
        destination_lane: 0,
        destination_cell: 3,
    }))
    .unwrap();
    let before = doc.to_json();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Incorporacion, &doc);
    let Connection::Incorporacion(rows) = draft.candidate(&doc).unwrap() else {
        panic!("merge draft");
    };
    assert_eq!(rows.len(), 2);
    assert_eq!(
        (
            rows[0].mapping.source_cell,
            rows[0].mapping.destination_cell
        ),
        (3, 4)
    );
    assert_eq!(
        (
            rows[1].mapping.source_cell,
            rows[1].mapping.destination_cell
        ),
        (0, 0)
    );
    draft.cancel();
    assert!(!draft.active());
    assert_eq!(doc.to_json(), before);
    assert_eq!(doc.model().connections().len(), 1);
}

#[test]
fn disabled_merge_row_is_absent_from_preview_validation_and_saved_link() {
    let mut doc = document();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Incorporacion, &doc);
    draft.rows_mut()[1].enabled = false;
    // Invalid hidden fields must not prevent saving the enabled lane.
    draft.rows_mut()[1].mapping.source_lane = 99;
    draft.rows_mut()[1].mapping.destination_cell = 999;
    assert_eq!(draft.preview_mappings().count(), 1);
    let candidate = draft.candidate(&doc).unwrap();
    let Connection::Incorporacion(rows) = &candidate else {
        panic!("merge draft");
    };
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].mapping.source_lane, 0);
    draft.rows_mut()[0].enabled = false;
    assert_eq!(
        draft.candidate(&doc),
        Err(ca_core::connections::ConnectionError::NoActiveRows)
    );
    doc.add_connection(candidate.clone()).unwrap();
    let restored = MapDocument::parse(&doc.to_json()).unwrap();
    assert_eq!(restored.model().connections(), &[candidate]);
}

#[test]
fn invalid_weights_and_duplicate_mappings_give_stable_translated_reasons() {
    use ca_core::connections::ConnectionError;
    let mut doc = document();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    let link = draft.candidate(&doc).unwrap();
    doc.model_mut().add_connection(link).unwrap();
    assert_eq!(draft.candidate(&doc), Err(ConnectionError::Duplicate));
    assert_eq!(
        ConnectionError::Duplicate.translation_key(),
        "connections.duplicate"
    );
    // A fresh weighted split shares one source and has two destinations.
    let doc = document();
    draft.set_kind(DraftKind::Probabilistica, &doc);
    assert!(draft.candidate(&doc).is_ok());
    for invalid in ["", "abc", "NaN", "inf", "-0.1", "1.5", "0.3"] {
        draft.rows_mut()[0].weight = invalid.into();
        assert_eq!(
            draft.candidate(&doc),
            Err(ConnectionError::Weights),
            "{invalid}"
        );
    }
    draft.rows_mut()[0].weight = "0.5".into();
    let duplicate = draft.rows_mut()[0].mapping;
    draft.rows_mut()[1].mapping = duplicate;
    assert_eq!(draft.candidate(&doc), Err(ConnectionError::Duplicate));
}

#[test]
fn connection_picking_blocks_cell_edits_geometry_handles_and_camera_pan() {
    use ca_app::map::MapInteraction;
    use eframe::egui;
    let doc = document();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 30.0], &doc.geometry(), vec!["A".into(), "B".into()]);
    map.configure(&doc, [0.0; 2]);
    map.select(Some(0));
    map.set_connection_picking(true);
    let mut run = |events| {
        let mut frame = None;
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(800.0, 600.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    frame = Some(map.show(ui, false));
                });
            },
        );
        frame.unwrap()
    };
    let initial = run(vec![]);
    let center = doc.geometry()[0].centers[0][1];
    let pos = initial.rect.min
        + egui::vec2(
            (center[0] - initial.view.origin[0]) / initial.view.span[0] * initial.rect.width(),
            (center[1] - initial.view.origin[1]) / initial.view.span[1] * initial.rect.height(),
        );
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    run(vec![egui::Event::PointerMoved(pos), button(pos, true)]);
    let click = run(vec![button(pos, false)]);
    assert_eq!(click.connection_pick, Some(0));
    assert!(click.clicked.is_none() && click.street_edit.is_none());
    run(vec![button(pos, true)]);
    let dragged = run(vec![egui::Event::PointerMoved(
        pos + egui::vec2(50.0, 20.0),
    )]);
    assert_eq!(dragged.view, initial.view);
    assert!(dragged.geometry_preview.is_none() && dragged.street_edit.is_none());
}

#[test]
fn panel_saves_only_valid_drafts_and_cancel_does_not_emit_a_link() {
    use ca_app::shell::Shell;
    use eframe::egui;
    let doc = document();
    let shell = Shell::load(None);
    let ctx = egui::Context::default();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    let panel = egui::Rect::from_min_size(egui::pos2(200.0, 50.0), egui::vec2(750.0, 700.0));
    let run = |draft: &mut ConnectionDraft, events| {
        let mut saved = None;
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1000.0, 800.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                saved = draft.show(ctx, panel, &doc, &shell);
            },
        );
        (output, saved)
    };
    run(&mut draft, vec![]);
    let output = run(&mut draft, vec![]).0;
    let button = |text: &str, output: &egui::FullOutput| {
        output
            .shapes
            .iter()
            .find_map(|shape| match &shape.shape {
                egui::Shape::Text(s) if s.galley.job.text == text => {
                    Some(s.visual_bounding_rect().center())
                }
                _ => None,
            })
            .expect(text)
    };
    let click = |pos, pressed| {
        vec![
            egui::Event::PointerMoved(pos),
            egui::Event::PointerButton {
                pos,
                pressed,
                button: egui::PointerButton::Primary,
                modifiers: egui::Modifiers::NONE,
            },
        ]
    };
    let save = button("Guardar", &output);
    assert!(save.x >= panel.left() && save.y >= panel.top());
    run(&mut draft, click(save, true));
    assert!(matches!(
        run(&mut draft, click(save, false)).1,
        Some(Connection::Lineal(_))
    ));
    // A failed queue submission can keep this draft open; the form must not cancel itself.
    assert!(draft.active());
    draft.set_kind(DraftKind::Probabilistica, &doc);
    draft.rows_mut()[0].weight = "invalid".into();
    let output = run(&mut draft, vec![]).0;
    assert!(output.shapes.iter().any(|shape| matches!(&shape.shape,
        egui::Shape::Text(s) if s.galley.job.text == shell.tr("connections.weights", &[]))));
    let save = button("Guardar", &output);
    run(&mut draft, click(save, true));
    assert!(run(&mut draft, click(save, false)).1.is_none());
    let cancel = button("Cancelar", &run(&mut draft, vec![]).0);
    run(&mut draft, click(cancel, true));
    assert!(run(&mut draft, click(cancel, false)).1.is_none());
    assert!(!draft.active());
    assert!(doc.model().connections().is_empty());
}

#[test]
fn saved_weighted_draft_survives_map_save_load_as_one_weighted_choice() {
    let mut doc = document();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Probabilistica, &doc);
    let link = draft.candidate(&doc).unwrap();
    doc.add_connection(link.clone()).unwrap();
    let loaded = MapDocument::parse(&doc.to_json()).unwrap();
    assert_eq!(loaded.model().connections(), &[link]);
}

#[test]
fn saved_weighted_draft_still_loads_after_a_destination_lane_is_removed() {
    use ca_core::streets::{StreetChange, StreetEdit};
    let mut doc = document();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Probabilistica, &doc);
    let link = draft.candidate(&doc).unwrap();
    doc.add_connection(link).unwrap();
    doc.edit_streets(StreetEdit::Update(
        1,
        StreetChange::Dimensions {
            lanes: 1,
            length: 5,
        },
    ))
    .unwrap();
    let loaded = MapDocument::parse(&doc.to_json()).unwrap();
    let Connection::Probabilistica(rows) = &loaded.model().connections()[0] else {
        panic!("split");
    };
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].weight, 1.0);
}

#[test]
fn roundabout_draft_uses_directional_defaults_and_accepts_reverse_seam_cells() {
    let doc = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"Ring","tipo":"conexion","geometryType":"roundabout",
         "x":100,"y":200,"innerRadius":5,"startAngle":30,
         "tamano":9,"carriles":2,"laneDirections":[1,-1]},
        {"nombre":"Exit","tipo":"conexion","tamano":4,"carriles":2,"laneDirections":[1,-1]}
    ]}"#,
    )
    .unwrap();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Incorporacion, &doc);
    let Connection::Incorporacion(rows) = draft.candidate(&doc).unwrap() else {
        panic!("merge");
    };
    assert_eq!(
        (
            rows[0].mapping.source_cell,
            rows[0].mapping.destination_cell
        ),
        (8, 0)
    );
    assert_eq!(
        (
            rows[1].mapping.source_cell,
            rows[1].mapping.destination_cell
        ),
        (0, 3)
    );
    draft.rows_mut()[1].mapping.source_cell = 8;
    assert!(
        draft.candidate(&doc).is_ok(),
        "roundabout reverse seam is valid"
    );
    draft.start();
    draft.pick(1, &doc);
    draft.pick(0, &doc);
    draft.set_kind(DraftKind::Incorporacion, &doc);
    draft.rows_mut()[1].mapping.destination_cell = 0;
    assert!(
        draft.candidate(&doc).is_ok(),
        "reverse roundabout entry at seam is valid"
    );
}

#[test]
fn live_map_preview_draws_only_enabled_merge_sources_and_tracks_endpoint_edits() {
    use ca_app::map::MapInteraction;
    use eframe::egui;
    let doc = document();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0, 30.0], &doc.geometry(), vec!["A".into(), "B".into()]);
    map.configure(&doc, [0.0; 2]);
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Incorporacion, &doc);
    draft.rows_mut()[1].enabled = false;
    let mut run = |draft: &ConnectionDraft| {
        ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(800.0, 600.0),
                )),
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    let frame = map.show(ui, false);
                    map.paint_connection_draft(ui.painter(), frame.rect, draft);
                });
            },
        )
    };
    let circles = |output: egui::FullOutput| {
        output
            .shapes
            .into_iter()
            .filter_map(|s| match s.shape {
                egui::Shape::Circle(c) if c.fill == egui::Color32::YELLOW => Some(c.center),
                _ => None,
            })
            .collect::<Vec<_>>()
    };
    let initial = circles(run(&draft));
    assert_eq!(initial.len(), 1);
    draft.rows_mut()[0].mapping.source_cell = 1;
    let edited = circles(run(&draft));
    assert_eq!(edited.len(), 1);
    assert!(edited[0].x < initial[0].x);
    draft.rows_mut()[0].enabled = false;
    assert!(circles(run(&draft)).is_empty());
}
