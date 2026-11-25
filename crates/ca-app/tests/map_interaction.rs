use ca_app::map::MapInteraction;
use eframe::egui;

fn frame(
    ctx: &egui::Context,
    map: &mut MapInteraction,
    events: Vec<egui::Event>,
    detect: bool,
) -> ca_app::map::MapFrame {
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
            egui::CentralPanel::default()
                .frame(egui::Frame::NONE)
                .show(ctx, |ui| {
                    result = Some(map.show(ui, detect));
                });
        },
    );
    result.unwrap()
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
    // Select the street, then start a second gesture on its middle handle.
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    assert!(
        frame(&ctx, &mut map, vec![button(start, false)], false)
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
    frame(
        &ctx,
        &mut map,
        vec![egui::Event::PointerMoved(start), button(start, true)],
        false,
    );
    frame(&ctx, &mut map, vec![button(start, false)], false);
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
    assert_eq!(scene.cells()[72], 1);
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
