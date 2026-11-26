use ca_app::{
    scenarios::{ScenarioCommand, ScenarioControls},
    shell::Shell,
};
use ca_core::disruptions::{Disruption, ScenarioAction};
use eframe::egui::{self, Event, Modifiers, PointerButton};

fn frame(
    controls: &mut ScenarioControls,
    ctx: &egui::Context,
    events: Vec<Event>,
) -> (egui::FullOutput, Option<ScenarioCommand>) {
    let mut command = None;
    let output = ctx.run(
        egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(1000., 900.),
            )),
            events,
            ..Default::default()
        },
        |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                command = controls.show(ui, &Shell::load(None));
            });
        },
    );
    (output, command)
}

fn text(output: &egui::FullOutput, label: &str) -> egui::Rect {
    fn find(shape: &egui::Shape, label: &str) -> Option<egui::Rect> {
        match shape {
            egui::Shape::Text(t) if t.galley.job.text == label => Some(t.visual_bounding_rect()),
            egui::Shape::Vec(v) => v.iter().find_map(|s| find(s, label)),
            _ => None,
        }
    }
    output
        .shapes
        .iter()
        .find_map(|s| find(&s.shape, label))
        .unwrap_or_else(|| panic!("{label}"))
}

fn click(
    controls: &mut ScenarioControls,
    ctx: &egui::Context,
    rect: egui::Rect,
) -> Option<ScenarioCommand> {
    let mut command = None;
    for pressed in [true, false] {
        let next = frame(
            controls,
            ctx,
            vec![
                Event::PointerMoved(rect.center()),
                Event::PointerButton {
                    pos: rect.center(),
                    button: PointerButton::Primary,
                    pressed,
                    modifiers: Modifiers::NONE,
                },
            ],
        )
        .1;
        command = command.or(next);
    }
    command
}

#[test]
fn controls_have_session_defaults_emit_one_shot_actions_and_confirm_clear() {
    let ctx = egui::Context::default();
    let mut controls = ScenarioControls::default();
    assert!(!controls.rain_active);
    assert_eq!(controls.rain_probability, 0.1);
    assert_eq!(controls.flood_percent, 10);
    frame(&mut controls, &ctx, vec![]);
    let output = frame(&mut controls, &ctx, vec![]).0;
    assert_eq!(
        click(&mut controls, &ctx, text(&output, "Inundar ahora")),
        Some(ScenarioCommand::Action(ScenarioAction::InstantFlood(10)))
    );
    assert_eq!(
        click(&mut controls, &ctx, text(&output, "Inundación")),
        Some(ScenarioCommand::Mode(Some(Disruption::Flood)))
    );
    assert!(controls.raining());
    assert_eq!(
        click(&mut controls, &ctx, text(&output, "Limpiar interrupciones")),
        None
    );
    frame(&mut controls, &ctx, vec![]);
    let confirmation = frame(&mut controls, &ctx, vec![]).0;
    assert_eq!(
        click(&mut controls, &ctx, text(&confirmation, "Confirmar")),
        Some(ScenarioCommand::Action(ScenarioAction::Clear))
    );
    controls = ScenarioControls::default();
    assert!(!controls.raining());
    assert_eq!(controls.flood_percent, 10);
}
