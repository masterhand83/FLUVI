use ca_app::{connections::ConnectionOverlays, shell::Shell};
use ca_core::camera::WorldView;
use ca_gpu::TrafficScene;
use eframe::egui::{self, Event, Modifiers, PointerButton};

#[test]
fn toolbar_hides_and_shows_every_arrow_at_physical_cell_centers() {
    let scene = TrafficScene::demo();
    let mut overlays = ConnectionOverlays::new(scene.connection_arrows());
    let ctx = egui::Context::default();
    let shell = Shell::load(None);
    let view = WorldView {
        origin: [0.0, 0.0],
        span: [36.0, 14.0],
    };
    let rect = egui::Rect::from_min_size(egui::pos2(10.0, 20.0), egui::vec2(720.0, 280.0));
    let arrows: Vec<_> = overlays.screen_arrows(view, rect).collect();
    assert_eq!(arrows.len(), 4);
    for (actual, expected) in [
        (arrows[0].0, egui::pos2(680.0, 70.0)),
        (arrows[0].1, egui::pos2(60.0, 150.0)),
        (arrows[1].0, egui::pos2(60.0, 90.0)),
        (arrows[1].1, egui::pos2(680.0, 170.0)),
    ] {
        assert!(
            actual.distance(expected) < 0.001,
            "{actual:?} != {expected:?}"
        );
    }

    let mut button = egui::Rect::NOTHING;
    for _ in 0..2 {
        let _ = ctx.run(egui::RawInput::default(), |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                button = overlays.show_toggle(ui, &shell).rect;
            });
        });
    }
    for expected in [0, 4] {
        for pressed in [true, false] {
            let _ = ctx.run(
                egui::RawInput {
                    events: vec![
                        Event::PointerMoved(button.center()),
                        Event::PointerButton {
                            pos: button.center(),
                            button: PointerButton::Primary,
                            pressed,
                            modifiers: Modifiers::NONE,
                        },
                    ],
                    ..Default::default()
                },
                |ctx| {
                    egui::CentralPanel::default().show(ctx, |ui| {
                        overlays.show_toggle(ui, &shell);
                    });
                },
            );
        }
        assert_eq!(overlays.screen_arrows(view, rect).count(), expected);
        let output = ctx.run(egui::RawInput::default(), |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                overlays.show_toggle(ui, &shell);
                overlays.paint(ui.painter(), view, rect);
            });
        });
        let lines = output
            .shapes
            .iter()
            .filter(|s| matches!(s.shape, egui::Shape::LineSegment { .. }))
            .count();
        // egui paints an arrow with one shaft and two head segments.
        assert_eq!(lines, expected * 3);
    }
}

#[test]
fn connection_validation_reasons_have_translations_in_both_languages() {
    use ca_app::shell::{Language, Translator};
    use ca_core::connections::ConnectionError;
    for language in [Language::English, Language::Spanish] {
        let translator = Translator::new(language);
        for reason in [
            ConnectionError::InvalidMapping,
            ConnectionError::Direction,
            ConnectionError::Duplicate,
            ConnectionError::NoActiveRows,
            ConnectionError::Weights,
            ConnectionError::SplitSource,
            ConnectionError::Probability,
        ] {
            let key = reason.translation_key();
            let message = translator.tr(key, &[]);
            assert_ne!(message, key);
            assert!(!message.is_empty());
        }
    }
}

#[test]
fn saved_connection_arrows_keep_their_type_colors_after_map_load() {
    use ca_core::{
        connections::{Connection, Mapping, MergeRow, WeightedRow},
        map_json::MapDocument,
    };
    let mut doc = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"A","tipo":"conexion","tamano":4,"x":25,"y":25},
        {"nombre":"B","tipo":"conexion","tamano":4,"x":75,"y":75}
    ]}"#,
    )
    .unwrap();
    let row = |source_cell, destination_cell| Mapping {
        source_street: 0,
        source_lane: 0,
        source_cell,
        destination_street: 1,
        destination_lane: 0,
        destination_cell,
    };
    doc.add_connection(Connection::Lineal(row(3, 0))).unwrap();
    doc.add_connection(Connection::Incorporacion(vec![MergeRow {
        mapping: row(2, 0),
        enabled: true,
    }]))
    .unwrap();
    doc.add_connection(Connection::Probabilistica(vec![
        WeightedRow {
            mapping: row(1, 1),
            weight: 0.6,
        },
        WeightedRow {
            mapping: row(1, 2),
            weight: 0.4,
        },
    ]))
    .unwrap();
    let loaded = MapDocument::parse(&doc.to_json()).unwrap();
    let scene = TrafficScene::from_document(&loaded);
    let overlays = ConnectionOverlays::new(scene.connection_arrows());
    let ctx = egui::Context::default();
    let output = ctx.run(egui::RawInput::default(), |ctx| {
        egui::CentralPanel::default().show(ctx, |ui| {
            overlays.paint(
                ui.painter(),
                WorldView {
                    origin: [0.0; 2],
                    span: [25.0; 2],
                },
                ui.max_rect(),
            );
        });
    });
    let colors: Vec<_> = output
        .shapes
        .iter()
        .filter_map(|s| match s.shape {
            egui::Shape::LineSegment { stroke, .. } => Some(stroke.color),
            _ => None,
        })
        .collect();
    assert_eq!(colors.len(), 12);
    assert_eq!(&colors[0..3], &[egui::Color32::from_rgb(34, 197, 94); 3]);
    assert_eq!(&colors[3..6], &[egui::Color32::from_rgb(249, 115, 22); 3]);
    assert_eq!(&colors[6..12], &[egui::Color32::from_rgb(168, 85, 247); 6]);
}
