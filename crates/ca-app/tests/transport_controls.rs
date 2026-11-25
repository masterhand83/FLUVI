use ca_app::{shell::Shell, transport::TransportControls};
use ca_core::traffic::VehicleAction;
use eframe::egui::{self, Event, Modifiers, PointerButton};

fn frame(
    controls: &mut TransportControls,
    ctx: &egui::Context,
    events: Vec<Event>,
) -> (egui::FullOutput, Option<VehicleAction>) {
    let shell = Shell::load(None);
    let mut action = None;
    let output = ctx.run(
        egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1200.0, 400.0),
            )),
            events,
            ..Default::default()
        },
        |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                action = controls.show(ui, &shell);
            });
        },
    );
    (output, action)
}

fn text_rect(output: &egui::FullOutput, text: &str) -> egui::Rect {
    fn find(shape: &egui::Shape, text: &str) -> Option<egui::Rect> {
        match shape {
            egui::Shape::Text(s) if s.galley.job.text == text => Some(s.visual_bounding_rect()),
            egui::Shape::Vec(shapes) => shapes.iter().find_map(|s| find(s, text)),
            _ => None,
        }
    }
    output
        .shapes
        .iter()
        .find_map(|s| find(&s.shape, text))
        .unwrap_or_else(|| panic!("missing {text}"))
}

fn click(
    controls: &mut TransportControls,
    ctx: &egui::Context,
    rect: egui::Rect,
) -> Option<VehicleAction> {
    let mut action = None;
    for pressed in [true, false] {
        action = action.or(frame(
            controls,
            ctx,
            vec![
                Event::PointerMoved(rect.center()),
                Event::PointerButton {
                    pos: rect.center(),
                    button: PointerButton::Primary,
                    pressed,
                    modifiers: Modifiers::default(),
                },
            ],
        )
        .1);
    }
    action
}

#[test]
fn buttons_emit_actions_and_override_is_off_in_a_new_session() {
    let mut controls = TransportControls::default();
    let ctx = egui::Context::default();
    frame(&mut controls, &ctx, vec![]);
    let (output, _) = frame(&mut controls, &ctx, vec![]);
    assert_eq!(controls.generation_override(), None);
    assert_eq!(
        click(&mut controls, &ctx, text_rect(&output, "Limpiar vehículos")),
        Some(VehicleAction::Clear)
    );
    assert_eq!(
        click(&mut controls, &ctx, text_rect(&output, "Llenado aleatorio")),
        Some(VehicleAction::Fill(0.3))
    );
    click(&mut controls, &ctx, text_rect(&output, "Generación global"));
    assert_eq!(controls.generation_override(), Some(0.3));
    let (output, _) = frame(&mut controls, &ctx, vec![]);
    click(&mut controls, &ctx, text_rect(&output, "Generación global"));
    assert_eq!(controls.generation_override(), None);
    assert_eq!(TransportControls::default().generation_override(), None);
}

fn key(key: egui::Key) -> Event {
    Event::Key {
        key,
        physical_key: None,
        pressed: true,
        repeat: false,
        modifiers: Modifiers::default(),
    }
}

#[test]
fn fill_slider_changes_the_fill_action_without_enabling_generation_override() {
    let mut controls = TransportControls::default();
    let ctx = egui::Context::default();
    frame(&mut controls, &ctx, vec![]);
    frame(&mut controls, &ctx, vec![]);
    // Keyboard order: Clear, Fill, fill-probability slider.
    for _ in 0..3 {
        frame(&mut controls, &ctx, vec![key(egui::Key::Tab)]);
    }
    frame(&mut controls, &ctx, vec![key(egui::Key::ArrowRight)]);
    let (output, _) = frame(&mut controls, &ctx, vec![]);
    assert_eq!(
        click(&mut controls, &ctx, text_rect(&output, "Llenado aleatorio")),
        Some(VehicleAction::Fill(0.31))
    );
    assert_eq!(controls.generation_override(), None);
}
