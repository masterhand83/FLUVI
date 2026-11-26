//! Session-only scenario controls. Cell changes use the ordered render queue.
use crate::shell::Shell;
use ca_core::disruptions::{Disruption, ScenarioAction};
use eframe::egui;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ScenarioCommand {
    Library,
    Mode(Option<Disruption>),
    Rain(bool, f64),
    Action(ScenarioAction),
}

pub struct ScenarioControls {
    pub active_name: Option<String>,
    pub mode: Option<Disruption>,
    pub rain_active: bool,
    pub rain_probability: f64,
    pub flood_percent: u8,
    confirm_clear: bool,
}

impl Default for ScenarioControls {
    fn default() -> Self {
        Self {
            active_name: None,
            mode: None,
            rain_active: false,
            rain_probability: 0.1,
            flood_percent: 10,
            confirm_clear: false,
        }
    }
}

impl ScenarioControls {
    pub fn loaded(&mut self, scenario: &ca_core::scenario_json::Scenario) {
        self.active_name = Some(scenario.name().to_owned());
        self.rain_active = false;
        self.rain_probability = scenario.probability();
        self.mode = None;
    }

    pub fn raining(&self) -> bool {
        self.rain_active || self.mode == Some(Disruption::Flood)
    }

    pub fn show(&mut self, ui: &mut egui::Ui, shell: &Shell) -> Option<ScenarioCommand> {
        let mut command = None;
        if let Some(name) = &self.active_name {
            ui.group(|ui| {
                ui.label(shell.tr("scenarios.active", &[("name", name)]));
            });
        }
        if ui.button(shell.tr("scenarios.library", &[])).clicked() {
            command = Some(ScenarioCommand::Library);
        }
        for (mode, key) in [
            (Disruption::LaneBlock, "scenarios.laneBlock"),
            (Disruption::Flood, "scenarios.flood"),
        ] {
            if ui
                .selectable_label(self.mode == Some(mode), shell.tr(key, &[]))
                .clicked()
            {
                self.mode = (self.mode != Some(mode)).then_some(mode);
                command = Some(ScenarioCommand::Mode(self.mode));
            }
        }
        let obstacle = matches!(
            self.mode,
            Some(Disruption::Pothole | Disruption::Worker | Disruption::Tree | Disruption::Cone)
        );
        if ui
            .selectable_label(obstacle, shell.tr("scenarios.obstacle", &[]))
            .clicked()
        {
            self.mode = (!obstacle).then_some(Disruption::Pothole);
            command = Some(ScenarioCommand::Mode(self.mode));
        }
        egui::ComboBox::from_label(shell.tr("scenarios.texture", &[]))
            .selected_text(shell.tr(texture_key(self.mode.unwrap_or(Disruption::Pothole)), &[]))
            .show_ui(ui, |ui| {
                for mode in [
                    Disruption::Pothole,
                    Disruption::Worker,
                    Disruption::Tree,
                    Disruption::Cone,
                    Disruption::Flood,
                ] {
                    if ui
                        .selectable_label(self.mode == Some(mode), shell.tr(texture_key(mode), &[]))
                        .clicked()
                    {
                        self.mode = Some(mode);
                        command = Some(ScenarioCommand::Mode(self.mode));
                    }
                }
            });
        let toggled = ui
            .checkbox(&mut self.rain_active, shell.tr("scenarios.rain", &[]))
            .changed();
        let changed = ui
            .add(
                egui::Slider::new(&mut self.rain_probability, 0.0..=1.0)
                    .custom_formatter(|v, _| format!("{:.0}%", v * 100.))
                    .custom_parser(|text| {
                        text.trim()
                            .trim_end_matches('%')
                            .parse::<f64>()
                            .ok()
                            .map(|v| v / 100.)
                    })
                    .text(shell.tr("scenarios.probability", &[])),
            )
            .changed();
        if toggled || changed {
            command = Some(ScenarioCommand::Rain(
                self.rain_active,
                self.rain_probability,
            ));
        }
        ui.add(
            egui::Slider::new(&mut self.flood_percent, 1..=100)
                .suffix("%")
                .text(shell.tr("scenarios.instantPercent", &[])),
        );
        for (key, action) in [
            (
                "scenarios.instant",
                ScenarioAction::InstantFlood(self.flood_percent),
            ),
            ("scenarios.massFlood", ScenarioAction::MassFlood),
            ("scenarios.potholes", ScenarioAction::RandomPotholes),
        ] {
            if ui.button(shell.tr(key, &[])).clicked() {
                command = Some(ScenarioCommand::Action(action));
            }
        }
        if ui.button(shell.tr("scenarios.clear", &[])).clicked() {
            self.confirm_clear = true;
        }
        if self.confirm_clear {
            egui::Window::new(shell.tr("scenarios.clear", &[]))
                .collapsible(false)
                .resizable(false)
                .show(ui.ctx(), |ui| {
                    ui.label(shell.tr("scenarios.clearConfirm", &[]));
                    if ui.button(shell.tr("common.confirm", &[])).clicked() {
                        command = Some(ScenarioCommand::Action(ScenarioAction::Clear));
                        self.confirm_clear = false;
                    }
                    if ui.button(shell.tr("common.cancel", &[])).clicked()
                        || ui.input(|i| i.key_pressed(egui::Key::Escape))
                    {
                        self.confirm_clear = false;
                    }
                });
        }
        command
    }

    /// Screen-space particles do not modify scenario cells or advance the clock.
    pub fn paint_rain(&self, painter: &egui::Painter, rect: egui::Rect) {
        if !self.raining() {
            return;
        }
        let painter = painter.with_clip_rect(rect);
        let time = painter.ctx().input(|i| i.time) as f32;
        for i in 0..160 {
            let x = (i as f32 * 73.7 - time * 85.).rem_euclid(rect.width().max(1.));
            let y = (i as f32 * 137.3 + time * 420.).rem_euclid(rect.height().max(1.));
            let start = rect.min + egui::vec2(x, y);
            painter.line_segment(
                [start, start + egui::vec2(-3., 12.)],
                egui::Stroke::new(
                    1_f32,
                    egui::Color32::from_rgba_unmultiplied(130, 190, 255, 110),
                ),
            );
        }
    }
}

fn texture_key(mode: Disruption) -> &'static str {
    match mode {
        Disruption::LaneBlock => "scenarios.laneBlock",
        Disruption::Flood => "scenarios.flood",
        Disruption::Pothole => "scenarios.pothole",
        Disruption::Worker => "scenarios.worker",
        Disruption::Tree => "scenarios.tree",
        Disruption::Cone => "scenarios.cone",
    }
}
