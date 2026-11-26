use ca_app::{control_panel::ControlPanel, shell::Shell, transport::TransportControls};
use ca_core::map_json::MapDocument;
use eframe::egui;

#[test]
fn map_files_are_inside_the_constructor_section_not_a_top_toolbar() {
    let path = std::env::temp_dir().join(format!("fluvi-panel-{}.json", std::process::id()));
    let prefs = ca_app::shell::Preferences {
        panels_open: [false, false, true, false, false, false, false],
        ..Default::default()
    };
    prefs.save(&path).unwrap();
    let mut shell = Shell::load(Some(path.clone()));
    let ctx = egui::Context::default();
    let document = MapDocument::empty();
    let mut transport = TransportControls::default();
    let mut output = None;
    for _ in 0..2 {
        output = Some(ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1100.0, 850.0),
                )),
                ..Default::default()
            },
            |ctx| {
                ControlPanel {
                    document: &document,
                    map: None,
                    connections: None,
                    saved_connections: &mut Default::default(),
                    transport: &mut transport,
                    scenarios: &mut Default::default(),
                    enabled: true,
                    files_ready: true,
                }
                .show(ctx, &mut shell);
            },
        ));
    }
    let output = output.unwrap();
    fn find(shape: &egui::Shape, label: &str) -> Option<egui::Rect> {
        match shape {
            egui::Shape::Text(s) if s.galley.job.text == label => Some(s.visual_bounding_rect()),
            egui::Shape::Vec(shapes) => shapes.iter().find_map(|s| find(s, label)),
            _ => None,
        }
    }
    let text = |label: &str| {
        output
            .shapes
            .iter()
            .find_map(|s| find(&s.shape, label))
            .unwrap_or_else(|| panic!("missing {label}"))
    };
    let open = text("Abrir mapa");
    assert!(open.left() < 400.0);
    assert!(open.top() > text("▼ 🏗️ Constructor de Mapas").bottom());
    assert!(open.bottom() < text("▶ ⚙️ Configuración de Calles").top());
    text("Guardar mapa");
    text("Nuevo mapa");
    std::fs::remove_file(path).unwrap();
}
