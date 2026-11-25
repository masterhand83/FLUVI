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
    assert_eq!(draft.preview_mappings(&doc).count(), 1);
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
fn invalid_probabilities_and_duplicate_mappings_give_stable_translated_reasons() {
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
    // Probabilities are checked independently, not as parts of a required total.
    let doc = document();
    draft.set_kind(DraftKind::Probabilistica, &doc);
    assert!(draft.candidate(&doc).is_ok());
    for invalid in ["", "abc", "NaN", "inf", "-0.1", "100.1", "101"] {
        draft.rows_mut()[0].probability = invalid.into();
        assert_eq!(
            draft.candidate(&doc),
            Err(ConnectionError::Probability),
            "{invalid}"
        );
    }
    draft.rows_mut()[0].probability = "50".into();
    draft.add_destination(&doc);
    let duplicate = draft.rows_mut()[0].mapping;
    draft.rows_mut()[1].mapping = duplicate;
    assert_eq!(draft.candidate(&doc), Err(ConnectionError::Duplicate));
}

#[test]
fn probability_percentages_convert_to_fractional_simulation_probabilities() {
    let doc = document();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Probabilistica, &doc);
    assert_eq!(draft.rows_mut()[0].probability, "100");
    draft.rows_mut()[0].probability = "70".into();
    draft.add_destination(&doc);
    draft.rows_mut()[1].mapping.destination_lane = 1;
    draft.rows_mut()[1].mapping.destination_cell = 0;
    draft.rows_mut()[1].probability = "30".into();
    let Connection::ProbabilityTrials(rows) = draft.candidate(&doc).unwrap() else {
        panic!("independent probabilities");
    };
    assert_eq!(rows[0].weight, 0.7);
    assert_eq!(rows[1].weight, 0.3);
    draft.rows_mut()[0].probability = "101".into();
    assert!(draft.candidate(&doc).is_err());
}

#[test]
fn probabilistic_draft_accepts_one_destination_and_does_not_require_a_total() {
    let doc = document();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Probabilistica, &doc);
    assert_eq!(draft.rows_mut().len(), 1);
    for percentage in ["0", "0.3", "25", "70", "100"] {
        draft.rows_mut()[0].probability = percentage.into();
        assert!(
            draft.candidate(&doc).is_ok(),
            "{percentage}% is valid on its own"
        );
    }
    draft.add_destination(&doc);
    draft.rows_mut()[1].mapping.destination_lane = 1;
    draft.rows_mut()[1].mapping.destination_cell = 0;
    for percentages in [["20", "30"], ["80", "80"], ["0", "0"]] {
        for (row, percentage) in draft.rows_mut().iter_mut().zip(percentages) {
            row.probability = percentage.into();
        }
        let Connection::ProbabilityTrials(rows) = draft.candidate(&doc).unwrap() else {
            panic!("independent trials, not a weighted split");
        };
        assert_eq!(rows.len(), 2);
    }
}

#[test]
fn fixed_endpoints_follow_selected_lane_directions_in_preview_and_saved_candidates() {
    let doc = document();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.rows_mut()[0].mapping.source_lane = 1;
    draft.rows_mut()[0].mapping.destination_lane = 1;
    draft.rows_mut()[0].mapping.source_cell = 2;
    draft.rows_mut()[0].mapping.destination_cell = 3;
    let Connection::Lineal(mapping) = draft.candidate(&doc).unwrap() else {
        panic!("linear");
    };
    assert_eq!((mapping.source_cell, mapping.destination_cell), (0, 0));
    assert_eq!(
        draft.preview_mappings(&doc).collect::<Vec<_>>(),
        vec![mapping]
    );

    draft.set_kind(DraftKind::Incorporacion, &doc);
    draft.rows_mut()[0].mapping.source_lane = 1;
    draft.rows_mut()[0].mapping.source_cell = 2;
    draft.rows_mut()[0].mapping.destination_cell = 2;
    let Connection::Incorporacion(rows) = draft.candidate(&doc).unwrap() else {
        panic!("incorporation");
    };
    assert_eq!(
        (
            rows[0].mapping.source_lane,
            rows[0].mapping.source_cell,
            rows[0].mapping.destination_cell
        ),
        (1, 0, 2)
    );
}

#[test]
fn map_pick_preview_tracks_hovered_lanes_without_changing_the_draft_or_live_links() {
    use ca_app::connection_draft::PickPreview;
    use ca_core::cell_index::CellRef;
    let doc = document();
    let before = doc.to_json();
    let mut draft = ConnectionDraft::default();
    draft.start();
    let source = CellRef {
        street: 0,
        lane: 1,
        index: 2,
    };
    assert_eq!(
        draft.preview_pick(Some(source), &doc),
        Some(PickPreview::Source(CellRef { index: 0, ..source }))
    );
    draft.pick_cell(source, &doc);
    let target = CellRef {
        street: 1,
        lane: 0,
        index: 2,
    };
    assert_eq!(
        draft.preview_pick(Some(target), &doc),
        Some(PickPreview::Link {
            source: CellRef { index: 0, ..source },
            target: Some(CellRef { index: 4, ..target }),
        })
    );
    let moved = CellRef {
        street: 1,
        lane: 1,
        index: 3,
    };
    assert_eq!(
        draft.preview_pick(Some(moved), &doc),
        Some(PickPreview::Link {
            source: CellRef { index: 0, ..source },
            target: Some(CellRef { index: 0, ..moved }),
        })
    );
    assert!(
        draft.candidate(&doc).is_err(),
        "hover must not finish the draft"
    );
    draft.pick_cell(moved, &doc);
    let Connection::Lineal(mapping) = draft.candidate(&doc).unwrap() else {
        panic!("linear");
    };
    assert_eq!(
        (
            mapping.source_lane,
            mapping.source_cell,
            mapping.destination_lane,
            mapping.destination_cell
        ),
        (1, 0, 1, 0)
    );
    assert_eq!(draft.preview_pick(Some(target), &doc), None);
    assert_eq!(doc.to_json(), before);
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
    assert_eq!(
        click.connection_pick,
        Some(ca_core::cell_index::CellRef {
            street: 0,
            lane: 0,
            index: 1
        })
    );
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
    draft.rows_mut()[0].probability = "invalid".into();
    let output = run(&mut draft, vec![]).0;
    assert!(output.shapes.iter().any(|shape| matches!(&shape.shape,
        egui::Shape::Text(s) if s.galley.job.text == shell.tr("connections.probability", &[]))));
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
fn saved_independent_draft_retains_probabilities_that_total_more_than_one_hundred_percent() {
    let mut doc = document();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Probabilistica, &doc);
    draft.rows_mut()[0].probability = "80".into();
    draft.add_destination(&doc);
    draft.rows_mut()[1].mapping.destination_lane = 1;
    draft.rows_mut()[1].mapping.destination_cell = 0;
    draft.rows_mut()[1].probability = "80".into();
    let link = draft.candidate(&doc).unwrap();
    doc.add_connection(link.clone()).unwrap();
    let saved: serde_json::Value = serde_json::from_str(&doc.to_json()).unwrap();
    assert_eq!(saved["conexiones"][0]["independentProbabilities"], true);
    assert!(saved["conexiones"][0].get("weightedSplit").is_none());
    let loaded = MapDocument::parse(&doc.to_json()).unwrap();
    assert_eq!(loaded.model().connections(), &[link]);
}

#[test]
fn removing_an_independent_destination_does_not_change_the_remaining_probability() {
    use ca_core::streets::{StreetChange, StreetEdit};
    let mut doc = document();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Probabilistica, &doc);
    draft.rows_mut()[0].probability = "35".into();
    draft.add_destination(&doc);
    draft.rows_mut()[1].mapping.destination_lane = 1;
    draft.rows_mut()[1].mapping.destination_cell = 0;
    draft.rows_mut()[1].probability = "80".into();
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
    let Connection::ProbabilityTrials(rows) = &loaded.model().connections()[0] else {
        panic!("independent probabilities");
    };
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].weight, 0.35);
}

#[test]
fn roundabout_draft_locks_source_exits_and_allows_reverse_target_seam_cells() {
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
    let Connection::Incorporacion(rows) = draft.candidate(&doc).unwrap() else {
        panic!("incorporation");
    };
    assert_eq!(
        rows[1].mapping.source_cell, 0,
        "the directional source exit stays fixed"
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
                    map.paint_connection_draft(ui.painter(), frame.rect, draft, &doc);
                });
            },
        )
    };
    let circles = |output: egui::FullOutput| {
        output
            .shapes
            .into_iter()
            .filter_map(|s| match s.shape {
                egui::Shape::Circle(c) if c.fill == egui::Color32::from_rgb(249, 115, 22) => {
                    Some(c.center)
                }
                _ => None,
            })
            .collect::<Vec<_>>()
    };
    let arrow_end = |output: &egui::FullOutput| {
        output
            .shapes
            .iter()
            .find_map(|s| match s.shape {
                egui::Shape::LineSegment { points, stroke }
                    if stroke.color == egui::Color32::from_rgb(249, 115, 22) =>
                {
                    Some(points[1])
                }
                _ => None,
            })
            .expect("incorporation arrow")
    };
    let output = run(&draft);
    let initial_end = arrow_end(&output);
    let initial = circles(output);
    assert_eq!(initial.len(), 1);
    draft.rows_mut()[0].mapping.destination_cell = 1;
    let output = run(&draft);
    assert_ne!(arrow_end(&output), initial_end);
    let edited = circles(output);
    assert_eq!(edited.len(), 1);
    assert_eq!(edited, initial, "the source column stays fixed");
    draft.rows_mut()[0].enabled = false;
    assert!(circles(run(&draft)).is_empty());
}

#[test]
fn lane_input_moves_the_preview_before_enter_or_focus_loss() {
    use ca_app::{map::MapInteraction, shell::Shell};
    use eframe::egui;
    let doc = document();
    let ctx = egui::Context::default();
    let shell = Shell::load(None);
    let mut map = MapInteraction::new([30.0; 2], &doc.geometry(), vec!["A".into(), "B".into()]);
    map.configure(&doc, [0.0; 2]);
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    let mut run = |draft: &mut ConnectionDraft, events| {
        ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1100.0, 900.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    let frame = map.show(ui, false);
                    draft.show(ctx, frame.rect, &doc, &shell);
                    map.paint_connection_draft(ui.painter(), frame.rect, draft, &doc);
                });
            },
        )
    };
    run(&mut draft, vec![]);
    let initial = run(&mut draft, vec![]);
    let pos = initial
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(t) if t.galley.job.text == "Carril 1" => {
                Some(t.visual_bounding_rect().center())
            }
            _ => None,
        })
        .expect("source lane input");
    let source_marker = |output: &egui::FullOutput| {
        output
            .shapes
            .iter()
            .find_map(|s| match s.shape {
                egui::Shape::Circle(c) if c.fill == egui::Color32::from_rgb(34, 197, 94) => {
                    Some(c.center)
                }
                _ => None,
            })
            .expect("linear source marker")
    };
    let initial_source = source_marker(&initial);
    for pressed in [true, false] {
        run(
            &mut draft,
            vec![
                egui::Event::PointerMoved(pos),
                egui::Event::PointerButton {
                    pos,
                    pressed,
                    button: egui::PointerButton::Primary,
                    modifiers: egui::Modifiers::NONE,
                },
            ],
        );
    }
    let edited = run(
        &mut draft,
        vec![
            egui::Event::Key {
                key: egui::Key::A,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: egui::Modifiers::COMMAND,
            },
            egui::Event::Text("2".into()),
        ],
    );
    assert!(
        ctx.wants_keyboard_input(),
        "the field must still have focus"
    );
    let Connection::Lineal(mapping) = draft.candidate(&doc).unwrap() else {
        panic!("linear");
    };
    assert_eq!((mapping.source_lane, mapping.source_cell), (1, 0));
    assert_ne!(source_marker(&edited), initial_source);
    assert!(doc.model().connections().is_empty());
}

#[test]
fn unfinished_line_follows_the_pointer_over_empty_map_space() {
    use ca_app::map::MapInteraction;
    use eframe::egui;
    let doc = document();
    let ctx = egui::Context::default();
    let mut map = MapInteraction::new([30.0; 2], &doc.geometry(), vec!["A".into(), "B".into()]);
    map.configure(&doc, [0.0; 2]);
    map.set_connection_picking(true);
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    let mut run = |events| {
        let mut frame = None;
        let output = ctx.run(
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
                    let current = map.show(ui, false);
                    map.paint_connection_draft(ui.painter(), current.rect, &draft, &doc);
                    frame = Some(current);
                });
            },
        );
        (output, frame.unwrap())
    };
    let (_, frame) = run(vec![]);
    let pointer = frame.rect.min
        + egui::vec2(
            (20.0 - frame.view.origin[0]) / frame.view.span[0] * frame.rect.width(),
            (25.0 - frame.view.origin[1]) / frame.view.span[1] * frame.rect.height(),
        );
    for pos in [pointer, pointer + egui::vec2(20.0, 10.0)] {
        let (output, frame) = run(vec![egui::Event::PointerMoved(pos)]);
        let end = output
            .shapes
            .iter()
            .find_map(|s| match s.shape {
                egui::Shape::LineSegment { points, stroke }
                    if stroke.color == egui::Color32::from_rgb(34, 197, 94) =>
                {
                    Some(points[1])
                }
                _ => None,
            })
            .expect("pointer guide");
        assert!(
            end.distance(pos) < 0.001,
            "the arrow must end at the live pointer"
        );
        assert!(frame.connection_pick.is_none() && frame.clicked.is_none());
    }
    assert!(draft.picking());
    assert!(doc.model().connections().is_empty());
}

#[test]
fn incorporation_target_cell_input_moves_the_line_while_the_field_has_focus() {
    use ca_app::{map::MapInteraction, shell::Shell};
    use eframe::egui;
    let doc = document();
    let ctx = egui::Context::default();
    let shell = Shell::load(None);
    let mut map = MapInteraction::new([30.0; 2], &doc.geometry(), vec!["A".into(), "B".into()]);
    map.configure(&doc, [0.0; 2]);
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Incorporacion, &doc);
    draft.rows_mut()[1].enabled = false;
    let mut run = |draft: &mut ConnectionDraft, events| {
        ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1100.0, 900.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    let frame = map.show(ui, false);
                    draft.show(ctx, frame.rect, &doc, &shell);
                    map.paint_connection_draft(ui.painter(), frame.rect, draft, &doc);
                });
            },
        )
    };
    run(&mut draft, vec![]);
    let initial = run(&mut draft, vec![]);
    let pos = initial
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(t) if t.galley.job.text == "Celda 4" => {
                Some(t.visual_bounding_rect().center())
            }
            _ => None,
        })
        .expect("editable incorporation target");
    let arrow_end = |output: &egui::FullOutput| {
        output
            .shapes
            .iter()
            .find_map(|s| match s.shape {
                egui::Shape::LineSegment { points, stroke }
                    if stroke.color == egui::Color32::from_rgb(249, 115, 22) =>
                {
                    Some(points[1])
                }
                _ => None,
            })
            .expect("incorporation arrow")
    };
    let initial_end = arrow_end(&initial);
    for pressed in [true, false] {
        run(
            &mut draft,
            vec![
                egui::Event::PointerMoved(pos),
                egui::Event::PointerButton {
                    pos,
                    pressed,
                    button: egui::PointerButton::Primary,
                    modifiers: egui::Modifiers::NONE,
                },
            ],
        );
    }
    let edited = run(
        &mut draft,
        vec![
            egui::Event::Key {
                key: egui::Key::A,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: egui::Modifiers::COMMAND,
            },
            egui::Event::Text("2".into()),
        ],
    );
    assert!(ctx.wants_keyboard_input());
    let Connection::Incorporacion(rows) = draft.candidate(&doc).unwrap() else {
        panic!("incorporation");
    };
    assert_eq!(
        (
            rows[0].mapping.source_cell,
            rows[0].mapping.destination_cell
        ),
        (3, 2)
    );
    assert_ne!(arrow_end(&edited), initial_end);
}

#[test]
fn percentage_text_is_validated_while_typing_before_enter_or_focus_loss() {
    use ca_app::shell::Shell;
    use eframe::egui;
    let doc = document();
    let shell = Shell::load(None);
    let ctx = egui::Context::default();
    let mut draft = ConnectionDraft::default();
    draft.start();
    draft.pick(0, &doc);
    draft.pick(1, &doc);
    draft.set_kind(DraftKind::Probabilistica, &doc);
    let run = |draft: &mut ConnectionDraft, events| {
        let mut saved = None;
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1100.0, 900.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                saved = draft.show(ctx, ctx.content_rect(), &doc, &shell);
            },
        );
        (output, saved)
    };
    run(&mut draft, vec![]);
    let initial = run(&mut draft, vec![]).0;
    let pos = initial
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(t) if t.galley.job.text == "100" => {
                Some(t.visual_bounding_rect().center())
            }
            _ => None,
        })
        .expect("percentage input");
    for pressed in [true, false] {
        run(
            &mut draft,
            vec![
                egui::Event::PointerMoved(pos),
                egui::Event::PointerButton {
                    pos,
                    pressed,
                    button: egui::PointerButton::Primary,
                    modifiers: egui::Modifiers::NONE,
                },
            ],
        );
    }
    let edited = run(
        &mut draft,
        vec![
            egui::Event::Key {
                key: egui::Key::A,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: egui::Modifiers::COMMAND,
            },
            egui::Event::Text("70".into()),
        ],
    )
    .0;
    assert!(ctx.wants_keyboard_input());
    assert_eq!(draft.rows_mut()[0].probability, "70");
    let Connection::ProbabilityTrials(rows) = draft.candidate(&doc).unwrap() else {
        panic!("one independent destination is valid");
    };
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].weight, 0.7);
    assert!(!edited.shapes.iter().any(|s| matches!(&s.shape,
        egui::Shape::Text(t) if t.galley.job.text == shell.tr("connections.probability", &[]))));
    assert!(edited.shapes.iter().any(|s| matches!(&s.shape,
        egui::Shape::Text(t) if t.galley.job.text == "Probabilidad (%)")));
    let save = edited
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(t) if t.galley.job.text == "Guardar" => {
                Some(t.visual_bounding_rect().center())
            }
            _ => None,
        })
        .expect("save button");
    let mut saved = None;
    for pressed in [true, false] {
        saved = run(
            &mut draft,
            vec![
                egui::Event::PointerMoved(save),
                egui::Event::PointerButton {
                    pos: save,
                    pressed,
                    button: egui::PointerButton::Primary,
                    modifiers: egui::Modifiers::NONE,
                },
            ],
        )
        .1
        .or(saved);
    }
    assert!(
        matches!(saved, Some(Connection::ProbabilityTrials(rows)) if rows.len() == 1 && rows[0].weight == 0.7)
    );
}
