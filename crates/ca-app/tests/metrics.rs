use ca_app::metrics::{Delivery, Metric, MetricsPanel, Packet};
use ca_core::{map_json::MapDocument, metrics::Metrics, virtual_time::Clock};
use crossbeam_channel::bounded;

#[test]
fn full_or_closed_chart_channel_never_blocks_or_loses_export_history() {
    let document = MapDocument::demo();
    let mut metrics = Metrics::new(document.model().streets());
    for _ in 0..65 {
        metrics.update(document.model().streets(), Clock::default());
    }
    let (tx, rx) = bounded(1);
    let mut delivery = Delivery::default();
    let mut panel = MetricsPanel::default();
    for _ in 0..70 {
        delivery.publish(&metrics, &tx);
        for packet in rx.try_iter() {
            panel.receive(packet);
        }
    }
    assert_eq!(panel.history().len(), 65);
    assert_eq!(panel.live().len(), 50);
    assert_eq!(panel.live()[0].elapsed_seconds, 32);
    assert_eq!(metrics.history().len(), 65);
    metrics.reset();
    delivery.reset();
    delivery.publish(&metrics, &tx);
    assert!(matches!(rx.try_recv(), Ok(Packet::Reset)));
    drop(rx);
    delivery.publish(&metrics, &tx);
}

#[test]
fn tooltip_contains_only_name_timestamp_value_and_short_status_in_both_languages() {
    let document = MapDocument::demo();
    let mut metrics = Metrics::new(document.model().streets());
    metrics.update(document.model().streets(), Clock::default());
    let shell = ca_app::shell::Shell::load(None);
    for language in [
        ca_app::shell::Language::Spanish,
        ca_app::shell::Language::English,
    ] {
        let translator = ca_app::shell::Translator::new(language);
        let lines = Metric::Density.tooltip(metrics.history()[0], &translator);
        assert_eq!(lines.len(), 4);
        assert!(lines[1].contains("07:00:00"));
        assert!(!lines.iter().any(|line| line.starts_with("metrics.")));
        // Labels are supplied by the active translator, not recorded in history.
        assert_eq!(lines[0], translator.tr("metrics.density", &[]));
    }
    // Keep shell use representative of the UI boundary.
    let ctx = eframe::egui::Context::default();
    let _ = ctx.run(Default::default(), |ctx| {
        eframe::egui::CentralPanel::default().show(ctx, |ui| {
            let mut panel = MetricsPanel::default();
            panel.show(ui, &shell);
        });
    });
}

#[test]
fn checklist_is_alphabetical_and_surviving_selection_follows_street_deletion() {
    let mut doc = MapDocument::demo();
    doc.edit_streets(ca_core::streets::StreetEdit::Update(
        0,
        ca_core::streets::StreetChange::Name("Zulu".into()),
    ))
    .unwrap();
    doc.edit_streets(ca_core::streets::StreetEdit::Update(
        1,
        ca_core::streets::StreetChange::Name("Alfa".into()),
    ))
    .unwrap();
    let mut panel = MetricsPanel::default();
    panel.configure(&doc, None);
    let rows = panel.rows();
    assert_eq!(rows[0], 1);
    panel.accept_selection(vec![true, false, true]);
    assert!(doc.delete_street(0));
    panel.configure(&doc, Some(0));
    assert_eq!(panel.included(), &[false, true]);
}

#[test]
fn checklist_applies_only_after_confirmation_and_cancel_keeps_selection() {
    use eframe::egui;
    let ctx = egui::Context::default();
    let doc = MapDocument::demo();
    let shell = ca_app::shell::Shell::load(None);
    let mut panel = MetricsPanel::default();
    panel.configure(&doc, None);
    panel.open_checklist();
    let mut selected = None;
    let mut frame = |panel: &mut MetricsPanel, events| {
        ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1200., 900.),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                if let Some(value) = panel.dialog(ctx, &doc, &shell) {
                    selected = Some(value);
                }
            },
        )
    };
    frame(&mut panel, vec![]);
    let output = frame(&mut panel, vec![]);
    let position = |label: &str| {
        output
            .shapes
            .iter()
            .find_map(|shape| {
                if let egui::Shape::Text(text) = &shape.shape
                    && text.galley.job.text == label
                {
                    Some(text.visual_bounding_rect().center())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| panic!("missing {label}"))
    };
    for label in ["Ninguna", "Aplicar"] {
        let pos = position(label);
        for pressed in [true, false] {
            frame(
                &mut panel,
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
        assert_eq!(
            panel.included(),
            &[true; 3],
            "draft must not alter live metrics"
        );
    }
    panel.accept_selection(selected.take().unwrap());
    assert_eq!(panel.included(), &[false; 3]);
    panel.open_checklist();
    let _ = ctx.run(
        egui::RawInput {
            events: vec![egui::Event::Key {
                key: egui::Key::Escape,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: egui::Modifiers::NONE,
            }],
            ..Default::default()
        },
        |ctx| {
            assert!(panel.dialog(ctx, &doc, &shell).is_none());
        },
    );
    assert_eq!(panel.included(), &[false; 3]);
}

#[test]
fn map_overlay_distinguishes_included_and_excluded_roads_and_hides_outside_pick_mode() {
    use ca_core::camera::WorldView;
    use eframe::egui;
    let document = MapDocument::parse(
        r#"{"calles":[
          {"nombre":"A","tipo":"conexion","tamano":3,"x":25,"y":25},
          {"nombre":"B","tipo":"conexion","tamano":3,"x":25,"y":50}
        ]}"#,
    )
    .unwrap();
    let mut panel = MetricsPanel::default();
    panel.configure(&document, None);
    panel.accept_selection(vec![true, false]);
    let ctx = egui::Context::default();
    let draw = |panel: &MetricsPanel| {
        ctx.run(Default::default(), |ctx| {
            let painter = ctx.layer_painter(egui::LayerId::background());
            panel.paint(
                &painter,
                WorldView {
                    origin: [0.; 2],
                    span: [20.; 2],
                },
                egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(400., 400.)),
                [0.; 2],
            );
        })
    };
    assert!(draw(&panel).shapes.is_empty());
    panel.picking = true;
    let shapes = draw(&panel).shapes;
    assert!(
        shapes
            .iter()
            .any(|s| matches!(&s.shape, egui::Shape::Path(p)
        if p.stroke.color == egui::epaint::ColorMode::Solid(egui::Color32::LIGHT_GREEN)))
    );
    assert!(shapes.iter().any(
        |s| matches!(&s.shape, egui::Shape::LineSegment { stroke, .. }
        if stroke.color == egui::Color32::LIGHT_RED)
    ));
}
