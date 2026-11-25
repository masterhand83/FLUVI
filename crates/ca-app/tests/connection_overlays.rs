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
