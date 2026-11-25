use ca_app::{inspector::StreetInspector, shell::Shell};
use ca_core::{
    map_json::MapDocument,
    streets::{StreetChange, StreetEdit},
};
use eframe::egui::{self, Event, Modifiers, PointerButton};

fn frame(
    inspector: &mut StreetInspector,
    ctx: &egui::Context,
    document: &MapDocument,
    events: Vec<Event>,
) -> (egui::FullOutput, Option<StreetEdit>) {
    let (output, edits) = frame_all(inspector, ctx, document, events);
    (output, edits.into_iter().next())
}

fn frame_all(
    inspector: &mut StreetInspector,
    ctx: &egui::Context,
    document: &MapDocument,
    events: Vec<Event>,
) -> (egui::FullOutput, Vec<StreetEdit>) {
    let mut edits = Vec::new();
    let output = ctx.run(
        egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1100.0, 850.0),
            )),
            events,
            ..Default::default()
        },
        |ctx| {
            edits = inspector
                .show(ctx, document, Some(0), &Shell::load(None))
                .edits;
        },
    );
    (output, edits)
}

fn click_text(
    inspector: &mut StreetInspector,
    ctx: &egui::Context,
    document: &MapDocument,
    text: &str,
) -> Vec<StreetEdit> {
    let (output, _) = frame_all(inspector, ctx, document, vec![]);
    let pos = text_rect(&output, text).center();
    let mut edits = Vec::new();
    for pressed in [true, false] {
        edits.extend(
            frame_all(
                inspector,
                ctx,
                document,
                vec![
                    Event::PointerMoved(pos),
                    Event::PointerButton {
                        pos,
                        button: PointerButton::Primary,
                        pressed,
                        modifiers: Modifiers::NONE,
                    },
                ],
            )
            .1,
        );
    }
    edits
}

#[test]
fn changing_focus_commits_the_pending_dimension_without_losing_a_switch_click() {
    for target in ["6", "Generar vehículos"] {
        let mut document = MapDocument::parse(
            r#"{"calles":[{
            "nombre":"North","tipo":"generador","tamano":6,"carriles":2
        }]}"#,
        )
        .unwrap();
        let ctx = egui::Context::default();
        let mut inspector = StreetInspector::default();
        frame(&mut inspector, &ctx, &document, vec![]);
        frame(&mut inspector, &ctx, &document, vec![]);
        click_text(&mut inspector, &ctx, &document, "2");
        frame(
            &mut inspector,
            &ctx,
            &document,
            vec![
                Event::Key {
                    key: egui::Key::A,
                    physical_key: None,
                    pressed: true,
                    repeat: false,
                    modifiers: Modifiers::COMMAND,
                },
                Event::Text("10".into()),
            ],
        );
        let edits = click_text(&mut inspector, &ctx, &document, target);
        assert!(
            edits.contains(&StreetEdit::Update(
                0,
                StreetChange::Dimensions {
                    lanes: 10,
                    length: 6
                }
            )),
            "{edits:?}"
        );
        if target == "Generar vehículos" {
            assert!(
                edits.contains(&StreetEdit::Update(
                    0,
                    StreetChange::LaneGeneration {
                        lane: 0,
                        enabled: false
                    }
                )),
                "{edits:?}"
            );
        }
        for edit in edits {
            document.edit_streets(edit).unwrap();
        }
        assert_eq!(document.model().streets()[0].config().carriles, 10);
    }
}

fn text_rect(output: &egui::FullOutput, text: &str) -> egui::Rect {
    output
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(s) if s.galley.job.text == text => Some(s.visual_bounding_rect()),
            _ => None,
        })
        .unwrap_or_else(|| panic!("missing text: {text}"))
}

#[test]
fn typing_ten_lanes_does_not_apply_the_destructive_one_lane_prefix() {
    let mut document = MapDocument::parse(
        r#"{"calles":[{
        "nombre":"North","tipo":"generador","tamano":6,"carriles":2,
        "laneDirections":[1,-1],"laneGenerationEnabled":[true,false]
    }]}"#,
    )
    .unwrap();
    document
        .model_mut()
        .toggle_vehicle(ca_core::cell_index::CellRef {
            street: 0,
            lane: 1,
            index: 1,
        });
    let ctx = egui::Context::default();
    let mut inspector = StreetInspector::default();
    frame(&mut inspector, &ctx, &document, vec![]);
    let (output, _) = frame(&mut inspector, &ctx, &document, vec![]);
    let pos = text_rect(&output, "2").center();
    for pressed in [true, false] {
        frame(
            &mut inspector,
            &ctx,
            &document,
            vec![
                Event::PointerMoved(pos),
                Event::PointerButton {
                    pos,
                    button: PointerButton::Primary,
                    pressed,
                    modifiers: Modifiers::NONE,
                },
            ],
        );
    }
    for events in [
        vec![
            Event::Key {
                key: egui::Key::A,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: Modifiers::COMMAND,
            },
            Event::Text("1".into()),
        ],
        vec![Event::Text("0".into())],
    ] {
        assert_eq!(frame(&mut inspector, &ctx, &document, events).1, None);
    }
    let (_, edit) = frame(
        &mut inspector,
        &ctx,
        &document,
        vec![Event::Key {
            key: egui::Key::Enter,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers: Modifiers::NONE,
        }],
    );
    assert_eq!(
        edit,
        Some(StreetEdit::Update(
            0,
            StreetChange::Dimensions {
                lanes: 10,
                length: 6
            }
        ))
    );
    document.edit_streets(edit.unwrap()).unwrap();
    assert_eq!(
        document.model().streets()[0].lane_direction(1),
        ca_core::traffic::LaneDirection::Reverse
    );
    assert_eq!(
        document.model().streets()[0]
            .config()
            .lane_generation_enabled[1],
        Some(false)
    );
    assert_eq!(document.model().streets()[0].cells()[7], 1);

    // Resume commits a complete focused dimension before ending the edit.
    let (output, _) = frame(&mut inspector, &ctx, &document, vec![]);
    let pos = text_rect(&output, "6").center();
    for pressed in [true, false] {
        frame(
            &mut inspector,
            &ctx,
            &document,
            vec![
                Event::PointerMoved(pos),
                Event::PointerButton {
                    pos,
                    button: PointerButton::Primary,
                    pressed,
                    modifiers: Modifiers::NONE,
                },
            ],
        );
    }
    assert_eq!(
        frame(
            &mut inspector,
            &ctx,
            &document,
            vec![
                Event::Key {
                    key: egui::Key::A,
                    physical_key: None,
                    pressed: true,
                    repeat: false,
                    modifiers: Modifiers::COMMAND
                },
                Event::Text("8".into()),
            ]
        )
        .1,
        None
    );
    let mut finished = None;
    let _ = ctx.run(
        egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1100.0, 850.0),
            )),
            ..Default::default()
        },
        |ctx| {
            // App handles Resume before drawing the inspector in this same frame.
            finished = inspector.finish(ctx, &document).unwrap();
            let response = inspector.show(ctx, &document, Some(0), &Shell::load(None));
            assert!(
                response.edits.is_empty(),
                "Resume must not emit a second edit"
            );
            assert!(!response.editing, "Resume must not enter edit pause again");
        },
    );
    assert_eq!(
        finished,
        Some(StreetEdit::Update(
            0,
            StreetChange::Dimensions {
                lanes: 10,
                length: 8
            }
        ))
    );
    assert_eq!(
        frame(&mut inspector, &ctx, &document, vec![]).1,
        None,
        "the inspector frame after Resume must not emit the same edit again"
    );
}

#[test]
fn invalid_length_shows_a_translated_reason_and_keeps_the_document() {
    let document =
        MapDocument::parse(r#"{"calles":[{"nombre":"North","tipo":"conexion","tamano":6}]}"#)
            .unwrap();
    let ctx = egui::Context::default();
    let mut inspector = StreetInspector::default();
    frame(&mut inspector, &ctx, &document, vec![]);
    let (output, _) = frame(&mut inspector, &ctx, &document, vec![]);
    let pos = text_rect(&output, "6").center();
    for pressed in [true, false] {
        frame(
            &mut inspector,
            &ctx,
            &document,
            vec![
                Event::PointerMoved(pos),
                Event::PointerButton {
                    pos,
                    button: PointerButton::Primary,
                    pressed,
                    modifiers: Modifiers::NONE,
                },
            ],
        );
    }
    let (_, edit) = frame(
        &mut inspector,
        &ctx,
        &document,
        vec![
            Event::Key {
                key: egui::Key::A,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: Modifiers::COMMAND,
            },
            Event::Text("0".into()),
        ],
    );
    assert_eq!(edit, None);
    let (output, _) = frame(&mut inspector, &ctx, &document, vec![]);
    text_rect(&output, "Use un número entero de celdas entre 1 y 2500.");
    assert_eq!(document.model().streets()[0].config().tamano, 6);
}

#[test]
fn structural_edits_block_steps_until_explicit_resume() {
    use ca_app::inspector::EditPause;
    let mut pause = EditPause::default();
    let mut playing = true;
    pause.begin(&mut playing);
    assert!(!playing);
    assert!(!pause.can_step(playing));
    pause.resume(&mut playing);
    assert!(playing);
    playing = false; // A normal Pause after Resume permits manual steps.
    assert!(pause.can_step(playing));
}

#[test]
fn selecting_a_street_opens_exact_fields_and_name_edits_apply_immediately() {
    let document =
        MapDocument::parse(r#"{"calles":[{"nombre":"North","tipo":"generador","tamano":6}]}"#)
            .unwrap();
    let ctx = egui::Context::default();
    let mut inspector = StreetInspector::default();
    frame(&mut inspector, &ctx, &document, vec![]);
    let (output, _) = frame(&mut inspector, &ctx, &document, vec![]);
    text_rect(&output, "Inspector de calle");
    text_rect(&output, "Generar vehículos");
    let pos = text_rect(&output, "North").center();
    for pressed in [true, false] {
        frame(
            &mut inspector,
            &ctx,
            &document,
            vec![
                Event::PointerMoved(pos),
                Event::PointerButton {
                    pos,
                    button: PointerButton::Primary,
                    pressed,
                    modifiers: Modifiers::NONE,
                },
            ],
        );
    }
    let (_, edit) = frame(
        &mut inspector,
        &ctx,
        &document,
        vec![
            Event::Key {
                key: egui::Key::A,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: Modifiers::COMMAND,
            },
            Event::Text("South".into()),
        ],
    );
    assert_eq!(
        edit,
        Some(StreetEdit::Update(0, StreetChange::Name("South".into())))
    );
}
