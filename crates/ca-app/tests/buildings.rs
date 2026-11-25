use ca_app::buildings::{BuildingEditor, Handle, Tool};
use ca_core::{
    buildings::{Building, BuildingEdit},
    map_json::MapDocument,
};

#[test]
fn invalid_vertex_drag_keeps_saved_geometry_and_returns_a_reason() {
    let mut map = MapDocument::empty();
    map.add_building(Building::polygon(vec![[0., 0.], [6., 0.], [6., 6.], [0., 6.]]).unwrap())
        .unwrap();
    let before = map.to_json();
    let mut editor = BuildingEditor::default();
    editor.begin_drag(&map, 0, Handle::Vertex(1), [6., 0.]);
    editor.drag_to([0., 6.], false);
    assert!(editor.error().is_some());
    assert!(editor.finish_drag().is_none());
    assert_eq!(map.to_json(), before);
}

#[test]
fn cancelling_delete_keeps_the_building_and_confirm_uses_shared_cleanup() {
    let mut map = MapDocument::empty();
    map.add_building(Building::rectangle([10., 20.], [8., 4.]))
        .unwrap();
    let mut editor = BuildingEditor::default();
    editor.select(Some(0));
    editor.request_delete();
    assert!(editor.answer_delete(false).is_none());
    assert_eq!(map.buildings().len(), 1);
    editor.request_delete();
    map.edit_buildings(editor.answer_delete(true).unwrap())
        .unwrap();
    assert!(map.buildings().is_empty());
}

#[test]
fn corner_drag_square_lock_and_polygon_finish_create_buildings() {
    let mut map = MapDocument::empty();
    let mut editor = BuildingEditor::default();
    editor.start(Tool::Rectangle);
    editor.rectangle_start([40., 30.]);
    editor.drag_to([10., 20.], true);
    map.edit_buildings(editor.finish_drag().unwrap()).unwrap();
    assert_eq!(map.buildings()[0].center, [25., 15.]);
    assert_eq!(map.buildings()[0].size, [30., 30.]);
    editor.start(Tool::Polygon);
    for p in [[0., 0.], [6., 0.], [6., 2.], [2., 2.], [2., 6.], [0., 6.]] {
        editor.push_vertex(p);
    }
    let edit = editor.finish_polygon().unwrap();
    assert!(matches!(edit, BuildingEdit::Create(_)));
    map.edit_buildings(edit).unwrap();
    assert!(!map.buildings()[1].contains([4., 4.]));
}

#[test]
fn rotated_resize_keeps_the_opposite_corner_fixed() {
    let mut map = MapDocument::empty();
    let mut building = Building::rectangle([10., 20.], [8., 4.]);
    building.angle = 90.;
    map.add_building(building).unwrap();
    let mut editor = BuildingEditor::default();
    editor.begin_drag(&map, 0, Handle::Corner(2), [8., 24.]);
    editor.drag_to([6., 28.], false);
    map.edit_buildings(editor.finish_drag().unwrap()).unwrap();
    let result = &map.buildings()[0];
    assert_eq!(result.center, [9., 22.]);
    assert!((result.size[0] - 12.).abs() < 1e-10);
    assert!((result.size[1] - 6.).abs() < 1e-10);
    let corner = result.points()[0];
    assert!((corner[0] - 12.).abs() < 1e-10);
    assert!((corner[1] - 16.).abs() < 1e-10);
}

#[test]
fn native_new_building_form_rejects_an_empty_name() {
    use ca_app::shell::Shell;
    use eframe::egui;
    let ctx = egui::Context::default();
    let mut editor = BuildingEditor::default();
    let map = MapDocument::empty();
    let mut shell = Shell::load(None);
    editor.open_form();
    let mut run = |events| {
        let mut edit = None;
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1000., 900.),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                edit = editor.forms(ctx, &map, &mut shell);
            },
        );
        (output, edit)
    };
    run(vec![]);
    let output = run(vec![]).0;
    // A blank name is rejected, rather than silently creating an unnamed building.
    let pos = output
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(text) if text.galley.job.text == "Crear edificio" => {
                Some(text.visual_bounding_rect().center())
            }
            _ => None,
        })
        .expect("create button");
    for pressed in [true, false] {
        let (_, edit) = run(vec![
            egui::Event::PointerMoved(pos),
            egui::Event::PointerButton {
                pos,
                pressed,
                button: egui::PointerButton::Primary,
                modifiers: egui::Modifiers::NONE,
            },
        ]);
        assert!(edit.is_none());
    }
    assert_eq!(editor.error().unwrap().0, "name-required");
}

fn form_frame(
    ctx: &eframe::egui::Context,
    editor: &mut BuildingEditor,
    map: &MapDocument,
    shell: &mut ca_app::shell::Shell,
    events: Vec<eframe::egui::Event>,
) -> (eframe::egui::FullOutput, Option<BuildingEdit>) {
    use eframe::egui;
    let mut edit = None;
    let output = ctx.run(
        egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1000., 900.),
            )),
            events,
            ..Default::default()
        },
        |ctx| {
            edit = editor.forms(ctx, map, shell);
        },
    );
    (output, edit)
}

fn text_rect(output: &eframe::egui::FullOutput, label: &str) -> eframe::egui::Rect {
    output
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            eframe::egui::Shape::Text(text) if text.galley.job.text == label => {
                Some(text.visual_bounding_rect())
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("missing UI label: {label}"))
}

fn pointer(pos: eframe::egui::Pos2, pressed: bool) -> Vec<eframe::egui::Event> {
    use eframe::egui;
    vec![
        egui::Event::PointerMoved(pos),
        egui::Event::PointerButton {
            pos,
            pressed,
            button: egui::PointerButton::Primary,
            modifiers: egui::Modifiers::NONE,
        },
    ]
}

#[test]
fn native_form_creates_a_named_building_and_escape_closes_it() {
    use ca_app::shell::Shell;
    use eframe::egui;
    let ctx = egui::Context::default();
    let mut editor = BuildingEditor::default();
    let mut map = MapDocument::empty();
    let mut shell = Shell::load(None);
    editor.open_form();
    form_frame(&ctx, &mut editor, &map, &mut shell, vec![]);
    let output = form_frame(&ctx, &mut editor, &map, &mut shell, vec![]).0;
    let name_pos = text_rect(&output, "Nombre").left_bottom() + egui::vec2(30., 14.);
    for pressed in [true, false] {
        form_frame(
            &ctx,
            &mut editor,
            &map,
            &mut shell,
            pointer(name_pos, pressed),
        );
    }
    let output = form_frame(
        &ctx,
        &mut editor,
        &map,
        &mut shell,
        vec![egui::Event::Text("Biblioteca".into())],
    )
    .0;
    let create = text_rect(&output, "Crear edificio").center();
    let mut created = None;
    for pressed in [true, false] {
        created = form_frame(
            &ctx,
            &mut editor,
            &map,
            &mut shell,
            pointer(create, pressed),
        )
        .1
        .or(created);
    }
    map.edit_buildings(created.expect("named building"))
        .unwrap();
    assert_eq!(map.buildings()[0].label, "Biblioteca");
    assert_eq!(map.buildings()[0].size, [100., 100.]);
    editor.open_form();
    let output = form_frame(
        &ctx,
        &mut editor,
        &map,
        &mut shell,
        vec![egui::Event::Key {
            key: egui::Key::Escape,
            physical_key: None,
            pressed: true,
            repeat: false,
            modifiers: egui::Modifiers::NONE,
        }],
    );
    assert!(output.1.is_none());
    assert!(!output.0.shapes.iter().any(
        |s| matches!(&s.shape, egui::Shape::Text(t) if t.galley.job.text == "Crear edificio")
    ));
    assert_eq!(map.buildings().len(), 1);
}

#[test]
fn inspector_delete_opens_the_shared_confirmation_and_cancel_keeps_data() {
    use ca_app::shell::Shell;
    use eframe::egui;
    let ctx = egui::Context::default();
    let mut editor = BuildingEditor::default();
    let mut map = MapDocument::empty();
    let mut building = Building::rectangle([0., 0.], [20., 30.]);
    building.label = "Stored name".into();
    map.add_building(building).unwrap();
    let before = map.to_json();
    let mut shell = Shell::load(None);
    editor.select(Some(0));
    form_frame(&ctx, &mut editor, &map, &mut shell, vec![]);
    let output = form_frame(&ctx, &mut editor, &map, &mut shell, vec![]).0;
    let delete = text_rect(&output, "Eliminar edificio").center();
    for pressed in [true, false] {
        assert!(
            form_frame(
                &ctx,
                &mut editor,
                &map,
                &mut shell,
                pointer(delete, pressed)
            )
            .1
            .is_none()
        );
    }
    assert!(
        shell
            .confirmation()
            .unwrap()
            .message
            .contains("Stored name")
    );
    shell.resolve_confirmation(false);
    assert!(
        form_frame(&ctx, &mut editor, &map, &mut shell, vec![])
            .1
            .is_none()
    );
    assert_eq!(map.to_json(), before);
}

#[test]
fn native_square_drag_does_not_pan_or_start_bulk_selection() {
    use ca_app::map::MapInteraction;
    use eframe::egui;
    let ctx = egui::Context::default();
    let mut editor = BuildingEditor::default();
    let mut interaction = MapInteraction::new([100., 100.], &[], vec![]);
    let mut map = MapDocument::empty();
    editor.start(Tool::Rectangle);
    let mut frame = |events, modifiers| {
        let mut edit = None;
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(400., 400.),
                )),
                events,
                modifiers,
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default()
                    .frame(egui::Frame::NONE)
                    .show(ctx, |ui| {
                        interaction.set_building_input(editor.active());
                        let result = interaction.show(ui, false);
                        assert!(!result.bulk_started);
                        assert!(result.clicked.is_none());
                        assert_eq!(result.view.origin, [0., 0.]);
                        edit = editor.input(ui, &map, result.rect, result.view, [0., 0.]);
                    });
            },
        );
        edit
    };
    frame(vec![], egui::Modifiers::NONE);
    let shift = egui::Modifiers {
        shift: true,
        ..Default::default()
    };
    let down = egui::pos2(100., 100.);
    let end = egui::pos2(200., 180.);
    let mut events = pointer(down, true);
    if let egui::Event::PointerButton { modifiers, .. } = &mut events[1] {
        *modifiers = shift;
    }
    frame(events, shift);
    frame(vec![egui::Event::PointerMoved(end)], shift);
    let mut events = pointer(end, false);
    if let egui::Event::PointerButton { modifiers, .. } = &mut events[1] {
        *modifiers = shift;
    }
    let created = frame(events, shift).expect("native drag");
    map.edit_buildings(created).unwrap();
    assert_eq!(map.buildings()[0].size, [125., 125.]);
    assert_eq!(map.buildings()[0].center, [187.5, 187.5]);
}

#[test]
fn native_form_retains_polygon_choice_between_frames() {
    use ca_app::shell::Shell;
    use eframe::egui;
    let ctx = egui::Context::default();
    let mut editor = BuildingEditor::default();
    let map = MapDocument::empty();
    let mut shell = Shell::load(None);
    editor.open_form();
    form_frame(&ctx, &mut editor, &map, &mut shell, vec![]);
    let output = form_frame(&ctx, &mut editor, &map, &mut shell, vec![]).0;
    let polygon = text_rect(&output, "Polígono").center();
    for pressed in [true, false] {
        form_frame(
            &ctx,
            &mut editor,
            &map,
            &mut shell,
            pointer(polygon, pressed),
        );
    }
    let output = form_frame(&ctx, &mut editor, &map, &mut shell, vec![]).0;
    assert!(text_rect(&output, "Vértices (px)").is_positive());
    let name = text_rect(&output, "Nombre").left_bottom() + egui::vec2(30., 14.);
    for pressed in [true, false] {
        form_frame(&ctx, &mut editor, &map, &mut shell, pointer(name, pressed));
    }
    let output = form_frame(
        &ctx,
        &mut editor,
        &map,
        &mut shell,
        vec![egui::Event::Text("Polygon".into())],
    )
    .0;
    let create = text_rect(&output, "Crear edificio").center();
    let mut edit = None;
    for pressed in [true, false] {
        edit = form_frame(
            &ctx,
            &mut editor,
            &map,
            &mut shell,
            pointer(create, pressed),
        )
        .1
        .or(edit);
    }
    let BuildingEdit::Create(building) = edit.unwrap() else {
        panic!("create")
    };
    assert_eq!(
        building.vertices.unwrap(),
        vec![[-50., -50.], [50., -50.], [50., 50.], [-50., 50.]]
    );
}

#[test]
fn delete_shortcut_opens_confirmation_before_street_input_consumes_it() {
    use ca_app::{map::MapInteraction, shell::Shell};
    use eframe::egui;
    let ctx = egui::Context::default();
    let mut editor = BuildingEditor::default();
    let mut map = MapDocument::empty();
    map.add_building(Building::rectangle([0., 0.], [10., 10.]))
        .unwrap();
    editor.select(Some(0));
    let mut interaction = MapInteraction::new([100., 100.], &[], vec![]);
    let mut shell = Shell::load(None);
    let _ = ctx.run(
        egui::RawInput {
            events: vec![egui::Event::Key {
                key: egui::Key::Delete,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: egui::Modifiers::NONE,
            }],
            ..Default::default()
        },
        |ctx| {
            editor.delete_shortcut(ctx, &map, &mut shell);
            egui::CentralPanel::default().show(ctx, |ui| {
                interaction.show(ui, false);
            });
        },
    );
    assert!(shell.confirmation().is_some());
    assert_eq!(map.buildings().len(), 1);
    shell.resolve_confirmation(false);
    assert!(
        form_frame(&ctx, &mut editor, &map, &mut shell, vec![])
            .1
            .is_none()
    );
    assert_eq!(map.buildings().len(), 1);
}
