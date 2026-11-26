use ca_app::{control_panel::ControlPanel, shell::Shell, transport::TransportControls};
use ca_core::map_json::MapDocument;
use eframe::egui;

#[test]
fn customization_shows_presets_and_previews_the_current_virtual_time() {
    let path =
        std::env::temp_dir().join(format!("fluvi-customization-{}.json", std::process::id()));
    ca_app::shell::Preferences {
        panels_open: [false, false, false, false, false, false, true],
        ..Default::default()
    }
    .save(&path)
    .unwrap();
    let mut shell = Shell::load(Some(path.clone()));
    let ctx = egui::Context::default();
    let document = MapDocument::parse(
        r##"{"calles":[],"personalizacion":{"fondoMapa":{"preset":"custom","color":"#39a57c"}}}"##,
    )
    .unwrap();
    let mut output = None;
    for _ in 0..2 {
        output = Some(ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1100., 1200.),
                )),
                ..Default::default()
            },
            |ctx| {
                ControlPanel {
                    labels: &mut Default::default(),
                    vehicle_heat: false,
                    metrics: &mut Default::default(),
                    document: &document,
                    map: None,
                    connections: None,
                    saved_connections: &mut Default::default(),
                    transport: &mut Default::default(),
                    scenarios: &mut Default::default(),
                    enabled: true,
                    files_ready: true,
                }
                .show_at(
                    ctx,
                    &mut shell,
                    ca_core::virtual_time::Clock::new(1, 0, 0, 0).unwrap(),
                );
            },
        ));
    }
    let shapes = output.unwrap().shapes;
    for label in [
        "Cielo",
        "Azul",
        "Guinda",
        "Gris",
        "Blanco",
        "Color personalizado",
        "Vista previa a la hora virtual",
    ] {
        assert!(
            shapes
                .iter()
                .any(|s| matches!(&s.shape, egui::Shape::Text(t) if t.galley.text() == label)),
            "missing {label}"
        );
    }
    assert!(
        shapes
            .iter()
            .any(|s| matches!(&s.shape, egui::Shape::Rect(r)
        if r.fill == egui::Color32::from_rgb(26, 74, 56) && r.rect.height() == 28.))
    );
    std::fs::remove_file(path).unwrap();
}

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
                    labels: &mut Default::default(),
                    vehicle_heat: false,
                    metrics: &mut Default::default(),
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
