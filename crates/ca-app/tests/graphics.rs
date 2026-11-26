use ca_app::{graphics::ExportQuality, shell::Preferences};

#[test]
fn export_quality_survives_restart_and_invalid_values_fall_back_to_balance() {
    let path = std::env::temp_dir().join(format!("fluvi-graphics-{}.json", std::process::id()));
    assert_eq!(
        Preferences::default().export_quality,
        ExportQuality::Balance
    );
    for (quality, code, width) in [
        (ExportQuality::Performance, "performance", 1600),
        (ExportQuality::Balance, "balance", 1600),
        (ExportQuality::Quality, "quality", 2400),
        (ExportQuality::Ultraquality, "ultraquality", 3200),
    ] {
        let prefs = Preferences {
            export_quality: quality,
            ..Default::default()
        };
        prefs.save(&path).unwrap();
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["export_quality"], code);
        let (loaded, warning) = Preferences::load(&path);
        assert!(!warning);
        assert_eq!(loaded.export_quality, quality);
        assert_eq!(quality.width(), width);
    }
    std::fs::write(&path, r#"{"export_quality":"unknown","dark_mode":true}"#).unwrap();
    let (loaded, warning) = Preferences::load(&path);
    assert!(warning);
    assert_eq!(loaded.export_quality, ExportQuality::Balance);
    assert!(loaded.dark_mode);
    std::fs::write(&path, "{}").unwrap();
    let (loaded, warning) = Preferences::load(&path);
    assert!(!warning);
    assert_eq!(loaded.export_quality, ExportQuality::Balance);
    std::fs::remove_file(path).unwrap();
}

fn shell_frame(
    ctx: &eframe::egui::Context,
    shell: &mut ca_app::shell::Shell,
    events: Vec<eframe::egui::Event>,
) -> eframe::egui::FullOutput {
    use eframe::egui;
    ctx.run(
        egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1000., 800.),
            )),
            events,
            ..Default::default()
        },
        |ctx| {
            shell.sidebar(ctx);
            shell.overlays(ctx);
        },
    )
}

fn click_label(ctx: &eframe::egui::Context, shell: &mut ca_app::shell::Shell, label: &str) {
    use eframe::egui;
    shell_frame(ctx, shell, vec![]);
    let frame = shell_frame(ctx, shell, vec![]);
    let position = frame
        .shapes
        .iter()
        .find_map(|shape| match &shape.shape {
            egui::Shape::Text(text) if text.galley.job.text == label => {
                Some(text.pos + text.galley.size() * 0.5)
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("missing {label}"));
    for pressed in [true, false] {
        shell_frame(
            ctx,
            shell,
            vec![
                egui::Event::PointerMoved(position),
                egui::Event::PointerButton {
                    pos: position,
                    button: egui::PointerButton::Primary,
                    pressed,
                    modifiers: egui::Modifiers::NONE,
                },
            ],
        );
    }
}

#[test]
fn advanced_settings_has_graphics_controls_that_save_the_selected_quality() {
    let path = std::env::temp_dir().join(format!("fluvi-graphics-ui-{}.json", std::process::id()));
    let mut shell = ca_app::shell::Shell::load(Some(path.clone()));
    let ctx = eframe::egui::Context::default();
    click_label(&ctx, &mut shell, "Configuración avanzada");
    let frame = shell_frame(&ctx, &mut shell, vec![]);
    for label in [
        "Gráficos",
        "Calidad de exportación",
        "Rendimiento",
        "Equilibrio",
        "Calidad",
        "Ultracalidad",
    ] {
        assert!(
            frame.shapes.iter().any(
                |s| matches!(&s.shape, eframe::egui::Shape::Text(t) if t.galley.job.text == label)
            ),
            "{label}"
        );
    }
    click_label(&ctx, &mut shell, "Calidad");
    assert_eq!(shell.preferences().export_quality, ExportQuality::Quality);
    assert_eq!(
        Preferences::load(&path).0.export_quality,
        ExportQuality::Quality
    );
    std::fs::remove_file(path).unwrap();
}
