use ca_app::{map::MapInteraction, minimap::Minimap};
use ca_core::map_json::MapDocument;
use eframe::egui;

#[test]
fn overview_coordinates_and_drag_target_match_the_main_camera() {
    let overview = Minimap::new([0., 0.], [100., 50.]);
    let rect = egui::Rect::from_min_size(egui::pos2(10., 20.), egui::vec2(200., 100.));
    assert_eq!(overview.world_at(rect, egui::pos2(160., 70.)), [75., 25.]);
    let mut map = MapInteraction::new([100., 50.], &[], vec![]);
    map.prepare_view([800., 400.]);
    overview.move_camera(&mut map, rect, egui::pos2(160., 70.), [0.; 2]);
    let camera = map.camera().unwrap();
    assert_eq!(camera.screen_to_world([400., 200.]), [75., 25.]);
    assert_eq!(
        overview.viewport(rect, camera.view()).center(),
        egui::pos2(160., 70.)
    );
}

#[test]
fn dragging_the_viewport_keeps_the_pointer_grab_offset_and_does_not_edit_the_map() {
    let document = MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":100,"x":0,"y":0}]}"#,
    )
    .unwrap();
    let geometry = document.geometry();
    let mut map = MapInteraction::new([100., 50.], &geometry, vec!["A".into()]);
    map.configure(&document, [0.; 2]);
    map.prepare_view([800., 400.]);
    map.set_drawing(true);
    let mut minimap = Minimap::new([0., 0.], [100., 50.]);
    let ctx = egui::Context::default();
    let rect = egui::Rect::from_min_size(egui::pos2(600., 280.), egui::vec2(200., 100.));
    // At fit, the viewport covers the overview. Grab 10 world units right of center.
    let start = egui::pos2(720., 330.);
    let end = egui::pos2(740., 340.);
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        pressed,
        button: egui::PointerButton::Primary,
        modifiers: egui::Modifiers::NONE,
    };
    let mut run = |events| {
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(816., 416.),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    let captured = minimap.captures(ctx, rect);
                    minimap.show(ui, rect, &mut map);
                    map.set_building_input(captured);
                    let frame = map.show(ui, false);
                    assert!(frame.street_edit.is_none());
                    assert!(frame.clicked.is_none());
                    assert!(frame.picked_cell.is_none());
                    assert!(!frame.bulk_started);
                });
            },
        );
    };
    run(vec![]);
    run(vec![egui::Event::PointerMoved(start), button(start, true)]);
    run(vec![egui::Event::PointerMoved(end)]);
    run(vec![button(end, false)]);
    let camera = map.camera().unwrap();
    let center = camera.screen_to_world([400., 200.]);
    assert!((center[0] - 60.).abs() < 1e-4);
    assert!((center[1] - 30.).abs() < 1e-4);
    assert_eq!(map.selected(), None);
}
