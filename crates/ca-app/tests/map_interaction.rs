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
