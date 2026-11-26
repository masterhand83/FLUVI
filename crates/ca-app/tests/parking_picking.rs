use ca_app::{parking::EndpointKind, parking_form::ParkingForms, shell::Shell};
use ca_core::{
    buildings::Building,
    cell_index::CellRef,
    map_json::MapDocument,
    parking::{ParkingConfig, ParkingPair},
};
use eframe::egui;

fn frame(
    ctx: &egui::Context,
    form: &mut ParkingForms,
    map: &MapDocument,
    events: Vec<egui::Event>,
) -> egui::FullOutput {
    let shell = Shell::load(None);
    ctx.run(
        egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1400., 1100.),
            )),
            events,
            ..Default::default()
        },
        |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| form.inspector(ui, map, &shell));
            form.show_dialog(ctx, map, &shell);
        },
    )
}

fn click(ctx: &egui::Context, form: &mut ParkingForms, map: &MapDocument, text: &str) {
    frame(ctx, form, map, vec![]);
    let output = frame(ctx, form, map, vec![]);
    let pos = output
        .shapes
        .iter()
        .find_map(|shape| match &shape.shape {
            egui::Shape::Text(t) if t.galley.job.text == text => {
                Some(t.visual_bounding_rect().center())
            }
            _ => None,
        })
        .expect(text);
    for pressed in [true, false] {
        frame(
            ctx,
            form,
            map,
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
}

#[test]
fn both_forms_offer_mouse_picking_and_escape_retains_the_draft() {
    let mut map = MapDocument::demo();
    map.add_building(Building::rectangle([0.; 2], [20.; 2]))
        .unwrap();
    let original = ParkingConfig::new(
        20,
        vec![ParkingPair {
            entrance: CellRef {
                street: 0,
                lane: 0,
                index: 1,
            },
            exit: CellRef {
                street: 0,
                lane: 0,
                index: 5,
            },
        }],
    );
    map.configure_parking(0, Some(original.clone())).unwrap();
    for dialog in [false, true] {
        let ctx = egui::Context::default();
        let mut form = ParkingForms::default();
        form.select(&map, Some(0), 0);
        if dialog {
            form.open_dialog();
        }
        click(&ctx, &mut form, &map, "Elegir entrada en mapa");
        assert_eq!(form.picking(), Some(EndpointKind::Entrance));
        click(&ctx, &mut form, &map, "Aplicar estacionamiento");
        assert!(
            form.take_request().is_none(),
            "Apply waits for the cell pick"
        );
        let entrance = CellRef {
            street: 0,
            lane: 1,
            index: 3,
        };
        assert!(form.pick_cell(entrance, &map));
        click(&ctx, &mut form, &map, "Elegir salida en mapa");
        assert_eq!(form.picking(), Some(EndpointKind::Exit));
        frame(
            &ctx,
            &mut form,
            &map,
            vec![egui::Event::Key {
                key: egui::Key::Escape,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: egui::Modifiers::NONE,
            }],
        );
        assert_eq!(form.picking(), None);
        assert!(form.has_draft(), "Escape cancels just the mouse pick");
        click(&ctx, &mut form, &map, "Aplicar estacionamiento");
        let (_, config) = form.take_request().unwrap();
        let config = config.unwrap();
        assert_eq!(config.pairs[0].entrance, entrance);
        assert_eq!(config.pairs[0].exit, original.pairs[0].exit);
        assert_eq!(map.model().parking(0).unwrap().config, original);
    }
}

#[test]
fn mouse_pick_over_a_building_fills_the_parking_row_instead_of_moving_or_toggling() {
    use ca_app::{buildings::BuildingEditor, map::MapInteraction};
    let mut document = MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":12,"carriles":2,"x":1000,"y":400}]}"#,
    ).unwrap();
    document
        .add_building(Building::rectangle([1020., 400.], [150., 150.]))
        .unwrap();
    let entrance = CellRef {
        street: 0,
        lane: 0,
        index: 1,
    };
    let picked_cell = CellRef {
        street: 0,
        lane: 1,
        index: 3,
    };
    document
        .configure_parking(
            0,
            Some(ParkingConfig::new(
                20,
                vec![ParkingPair {
                    entrance,
                    exit: CellRef {
                        index: 5,
                        ..entrance
                    },
                }],
            )),
        )
        .unwrap();
    let geometry = document.geometry();
    let mut map = MapInteraction::new([300., 200.], &geometry, vec!["A".into()]);
    map.configure(&document, [0.; 2]);
    let mut editor = BuildingEditor::default();
    editor.select(Some(0));
    let mut shell = Shell::load(None);
    let ctx = egui::Context::default();
    let mut picked = None;
    let mut frame =
        |editor: &mut BuildingEditor, map: &mut MapInteraction, events: Vec<egui::Event>| {
            let modifiers = events
                .iter()
                .rev()
                .find_map(|event| match event {
                    egui::Event::PointerButton { modifiers, .. } => Some(*modifiers),
                    _ => None,
                })
                .unwrap_or_default();
            ctx.run(
                egui::RawInput {
                    screen_rect: Some(egui::Rect::from_min_size(
                        egui::Pos2::ZERO,
                        egui::vec2(1400., 1100.),
                    )),
                    events,
                    modifiers,
                    ..Default::default()
                },
                |ctx| {
                    egui::CentralPanel::default()
                        .frame(egui::Frame::NONE)
                        .show(ctx, |ui| {
                            map.set_cell_picking(
                                editor
                                    .parking_picking()
                                    .then_some(ca_app::map::CellPickMode::Parking),
                            );
                            let shown = map.show(ui, false);
                            assert!(shown.clicked.is_none(), "picking must not toggle traffic");
                            assert!(shown.street_edit.is_none());
                            assert!(!shown.bulk_started);
                            let handled = editor.parking_input(ctx, &shown, &document);
                            if !handled {
                                assert!(
                                    editor
                                        .input(ui, &document, shown.rect, shown.view, [0.; 2])
                                        .is_none()
                                );
                            }
                            editor.sync_parking_form(&document, 0);
                            assert!(editor.forms(ctx, &document, &mut shell).is_none());
                            editor.paint_parking_pick(ui.painter(), &shown, &document, &shell);
                            if shown.picked_cell.is_some() {
                                picked = shown.picked_cell;
                            }
                        });
                },
            )
        };
    frame(&mut editor, &mut map, vec![]);
    let output = frame(&mut editor, &mut map, vec![]);
    let pick_button = output
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(t) if t.galley.job.text == "Elegir entrada en mapa" => {
                Some(t.visual_bounding_rect().center())
            }
            _ => None,
        })
        .expect("entrance pick button");
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    for pressed in [true, false] {
        frame(
            &mut editor,
            &mut map,
            vec![
                egui::Event::PointerMoved(pick_button),
                button(pick_button, pressed),
            ],
        );
    }
    assert!(editor.parking_picking());
    // Physical cell is fixed by the fixture; use the camera only to locate it.
    let point = map
        .camera()
        .unwrap()
        .world_to_screen(geometry[0].centers[1][3]);
    let position = egui::pos2(point[0], point[1]);
    let output = frame(
        &mut editor,
        &mut map,
        vec![egui::Event::PointerMoved(position)],
    );
    assert!(output.shapes.iter().any(|s| matches!(&s.shape,
        egui::Shape::Text(t) if t.galley.job.text == "● Entrada: A · Carril 2 · Celda 4")));
    for pressed in [true, false] {
        frame(
            &mut editor,
            &mut map,
            vec![egui::Event::PointerButton {
                pos: position,
                pressed,
                button: egui::PointerButton::Primary,
                modifiers: egui::Modifiers::SHIFT,
            }],
        );
    }
    assert!(!editor.parking_picking());
    assert_eq!(editor.selected(), Some(0));
    // Continue in the alternative form; it must retain the inspector's map pick.
    let output = frame(&mut editor, &mut map, vec![]);
    let dialog_button = output
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(t) if t.galley.job.text == "Configuración de estacionamiento" => {
                Some(t.visual_bounding_rect().center())
            }
            _ => None,
        })
        .unwrap();
    for pressed in [true, false] {
        frame(
            &mut editor,
            &mut map,
            vec![
                egui::Event::PointerMoved(dialog_button),
                button(dialog_button, pressed),
            ],
        );
    }
    frame(&mut editor, &mut map, vec![]);
    let output = frame(&mut editor, &mut map, vec![]);
    let apply = output
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(t) if t.galley.job.text == "Aplicar estacionamiento" => {
                Some(t.visual_bounding_rect().center())
            }
            _ => None,
        })
        .unwrap();
    for pressed in [true, false] {
        frame(
            &mut editor,
            &mut map,
            vec![egui::Event::PointerMoved(apply), button(apply, pressed)],
        );
    }
    assert_eq!(picked, Some(picked_cell));
    let config = editor
        .take_parking_request(&document, 0)
        .unwrap()
        .1
        .unwrap();
    assert_eq!(config.pairs[0].entrance, picked_cell);
    assert_eq!(
        config.pairs[0].exit,
        CellRef {
            index: 5,
            ..entrance
        }
    );
    assert_eq!(document.buildings()[0].center, [1020., 400.]);
}
