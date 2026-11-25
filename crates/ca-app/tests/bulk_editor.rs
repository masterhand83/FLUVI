use ca_app::{bulk_editor::BulkEditor, shell::Shell};
use ca_core::{map_json::MapDocument, streets::StreetEdit};
use eframe::egui;

#[test]
fn bulk_panel_exposes_only_lanes_and_directions_and_submits_one_edit() {
    let ctx = egui::Context::default();
    let document = MapDocument::demo();
    let mut panel = BulkEditor::default();
    let mut run = |events| {
        let mut result = None;
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1000.0, 900.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                result = Some(panel.show(ctx, &document, &[0, 1], &Shell::load(None)));
            },
        );
        (output, result.unwrap())
    };
    run(vec![]);
    let output = run(vec![]).0;
    let text: Vec<_> = output
        .shapes
        .iter()
        .filter_map(|s| match &s.shape {
            egui::Shape::Text(s) => Some(s.galley.job.text.as_str()),
            _ => None,
        })
        .collect();
    assert!(text.contains(&"Carriles (1–10)"));
    assert!(!text.contains(&"Nombre"));
    assert!(!text.contains(&"Generar vehículos"));
    let pos = output
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(s) if s.galley.job.text == "Aplicar" => {
                Some(s.visual_bounding_rect().center())
            }
            _ => None,
        })
        .unwrap();
    let mut edit = None;
    for pressed in [true, false] {
        edit = run(vec![
            egui::Event::PointerMoved(pos),
            egui::Event::PointerButton {
                pos,
                pressed,
                button: egui::PointerButton::Primary,
                modifiers: egui::Modifiers::NONE,
            },
        ])
        .1
        .edit
        .or(edit);
    }
    assert!(matches!(edit, Some(StreetEdit::Bulk { streets, lanes: 2, .. }) if streets == [0, 1]));
}
