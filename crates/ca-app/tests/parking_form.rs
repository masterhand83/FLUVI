use ca_app::parking_form::{EndpointDraft, PairDraft, ParkingDraft};
use ca_core::{buildings::Building, map_json::MapDocument};

fn document() -> MapDocument {
    let mut map = MapDocument::demo();
    map.add_building(Building::rectangle([0.; 2], [20.; 2]))
        .unwrap();
    map
}

#[test]
fn incomplete_rows_keep_live_parking_and_complete_rows_convert_one_based_indices() {
    let mut map = document();
    let mut draft = ParkingDraft::new(&map, 0);
    draft.enabled = true;
    draft.capacity = "12".into();
    draft.pairs.push(PairDraft::default());
    assert!(draft.candidate(&map, 0).is_err());
    assert!(map.model().parking(0).is_none());
    draft.pairs[0] = PairDraft {
        entrance: EndpointDraft {
            street: Some(0),
            lane: "1".into(),
            cell: "2".into(),
        },
        exit: EndpointDraft {
            street: Some(0),
            lane: "2".into(),
            cell: "6".into(),
        },
    };
    let config = draft.candidate(&map, 0).unwrap().unwrap();
    assert_eq!(config.capacity, 12);
    assert_eq!(
        (
            config.pairs[0].entrance.lane,
            config.pairs[0].entrance.index
        ),
        (0, 1)
    );
    assert_eq!(
        (config.pairs[0].exit.lane, config.pairs[0].exit.index),
        (1, 5)
    );
    map.configure_parking(0, Some(config.clone())).unwrap();
    draft.pairs[0].exit.cell.clear();
    assert!(draft.candidate(&map, 0).is_err());
    assert_eq!(map.model().parking(0).unwrap().config, config);
    let restored = ParkingDraft::new(&map, 0);
    assert_eq!(restored.pairs[0].exit.cell, "6");
}

#[test]
fn presets_match_all_v1_hourly_values() {
    use ca_app::parking_form::Preset;
    let map = document();
    let mut draft = ParkingDraft::new(&map, 0);
    for (preset, entry, exit) in [
        (Preset::Normal, [30; 24], [20; 24]),
        (
            Preset::Office,
            [
                20, 20, 10, 10, 10, 20, 40, 60, 70, 50, 30, 20, 10, 10, 10, 20, 30, 60, 70, 50, 30,
                20, 20, 20,
            ],
            [
                10, 10, 10, 10, 10, 10, 20, 30, 20, 10, 10, 30, 50, 60, 40, 20, 20, 50, 70, 60, 40,
                20, 10, 10,
            ],
        ),
        (
            Preset::Shopping,
            [
                10, 10, 10, 10, 10, 10, 20, 30, 40, 50, 60, 70, 70, 60, 60, 70, 70, 80, 80, 70, 50,
                40, 30, 20,
            ],
            [
                10, 10, 10, 10, 10, 10, 10, 10, 10, 20, 30, 40, 50, 50, 40, 50, 60, 70, 80, 80, 70,
                60, 40, 20,
            ],
        ),
    ] {
        draft.preset(preset);
        assert_eq!(draft.entry, entry.map(|n| n.to_string()));
        assert_eq!(draft.exit, exit.map(|n| n.to_string()));
    }
}

#[test]
fn invalid_percentages_and_duplicate_endpoints_cannot_be_applied() {
    let map = document();
    let mut draft = ParkingDraft::new(&map, 0);
    draft.enabled = true;
    draft.pairs.push(PairDraft {
        entrance: EndpointDraft {
            street: Some(0),
            lane: "1".into(),
            cell: "2".into(),
        },
        exit: EndpointDraft {
            street: Some(0),
            lane: "1".into(),
            cell: "6".into(),
        },
    });
    draft.entry[23] = "101".into();
    assert_eq!(
        draft.candidate(&map, 0).unwrap_err().translation_key(),
        "parking.validation.probability"
    );
    draft.entry[23] = "12.5".into();
    assert_eq!(
        draft
            .candidate(&map, 0)
            .unwrap()
            .unwrap()
            .entry_probabilities[23],
        0.125
    );
    draft.pairs[0].exit.cell = "2".into();
    assert_eq!(
        draft.candidate(&map, 0).unwrap_err().translation_key(),
        "parking.validation.duplicateEndpoint"
    );
    draft.enabled = false;
    assert_eq!(draft.candidate(&map, 0).unwrap(), None);
}

#[test]
fn inspector_and_dialog_apply_the_same_config_and_keep_unaccepted_drafts() {
    use ca_app::{parking_form::ParkingForms, shell::Shell};
    use eframe::egui;
    let mut map = document();
    let mut draft = ParkingDraft::new(&map, 0);
    draft.enabled = true;
    draft.pairs.push(PairDraft {
        entrance: EndpointDraft {
            street: Some(0),
            lane: "1".into(),
            cell: "2".into(),
        },
        exit: EndpointDraft {
            street: Some(0),
            lane: "1".into(),
            cell: "6".into(),
        },
    });
    map.configure_parking(0, draft.candidate(&map, 0).unwrap())
        .unwrap();
    let shell = Shell::load(None);
    let mut results = Vec::new();
    for dialog in [false, true] {
        let ctx = egui::Context::default();
        let mut forms = ParkingForms::default();
        forms.select(&map, Some(0), 0);
        if dialog {
            forms.open_dialog();
        }
        let frame = |forms: &mut ParkingForms, events| {
            ctx.run(
                egui::RawInput {
                    screen_rect: Some(egui::Rect::from_min_size(
                        egui::Pos2::ZERO,
                        egui::vec2(1200., 1000.),
                    )),
                    events,
                    ..Default::default()
                },
                |ctx| {
                    egui::CentralPanel::default().show(ctx, |ui| forms.inspector(ui, &map, &shell));
                    forms.show_dialog(ctx, &map, &shell);
                },
            )
        };
        frame(&mut forms, vec![]);
        let output = frame(&mut forms, vec![]);
        let capacity_pos = output
            .shapes
            .iter()
            .find_map(|s| match &s.shape {
                egui::Shape::Text(text) if text.galley.job.text == "100" => {
                    Some(text.visual_bounding_rect().center())
                }
                _ => None,
            })
            .expect("capacity input");
        for pressed in [true, false] {
            frame(
                &mut forms,
                vec![
                    egui::Event::PointerMoved(capacity_pos),
                    egui::Event::PointerButton {
                        pos: capacity_pos,
                        pressed,
                        button: egui::PointerButton::Primary,
                        modifiers: egui::Modifiers::NONE,
                    },
                ],
            );
        }
        frame(
            &mut forms,
            vec![
                egui::Event::Key {
                    key: egui::Key::A,
                    physical_key: None,
                    pressed: true,
                    repeat: false,
                    modifiers: egui::Modifiers::CTRL | egui::Modifiers::COMMAND,
                },
                egui::Event::Text("12".into()),
            ],
        );
        // A name/color edit advances the session revision, not street topology.
        forms.select(&map, Some(0), 1);
        let output = frame(&mut forms, vec![]);
        let pos = output
            .shapes
            .iter()
            .find_map(|s| match &s.shape {
                egui::Shape::Text(text) if text.galley.job.text == "Aplicar estacionamiento" => {
                    Some(text.visual_bounding_rect().center())
                }
                _ => None,
            })
            .expect("shared Apply control");
        for pressed in [true, false] {
            frame(
                &mut forms,
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
        results.push(forms.take_request().expect("Apply emits a configuration"));
        assert!(forms.has_draft(), "queue failure must retain the form");
        if dialog {
            frame(
                &mut forms,
                vec![egui::Event::Key {
                    key: egui::Key::Escape,
                    physical_key: None,
                    pressed: true,
                    repeat: false,
                    modifiers: egui::Modifiers::NONE,
                }],
            );
        } else {
            let output = frame(&mut forms, vec![]);
            let cancel = output
                .shapes
                .iter()
                .find_map(|s| match &s.shape {
                    egui::Shape::Text(text) if text.galley.job.text == "Cancelar" => {
                        Some(text.visual_bounding_rect().center())
                    }
                    _ => None,
                })
                .expect("Cancel control");
            for pressed in [true, false] {
                frame(
                    &mut forms,
                    vec![
                        egui::Event::PointerMoved(cancel),
                        egui::Event::PointerButton {
                            pos: cancel,
                            pressed,
                            button: egui::PointerButton::Primary,
                            modifiers: egui::Modifiers::NONE,
                        },
                    ],
                );
            }
        }
        assert!(!forms.has_draft());
        assert!(forms.take_request().is_none());
    }
    assert_eq!(results[0], results[1]);
    let config = results[0].1.as_ref().unwrap();
    assert_eq!(config.capacity, 12);
    assert_eq!(config.pairs, map.model().parking(0).unwrap().config.pairs);
    assert_eq!(
        map.model().parking(0).unwrap().config.capacity,
        100,
        "Apply is not live until acknowledged"
    );
}
