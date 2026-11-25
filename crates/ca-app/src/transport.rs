//! Session-only transport controls, separate from saved preferences.
use crate::shell::Shell;
use ca_core::traffic::VehicleAction;
use eframe::egui;

pub struct TransportControls {
    fill_probability: f64,
    generation_probability: f64,
    override_enabled: bool,
}

impl Default for TransportControls {
    fn default() -> Self {
        Self {
            fill_probability: 0.3,
            generation_probability: 0.3,
            override_enabled: false,
        }
    }
}

impl TransportControls {
    pub fn generation_override(&self) -> Option<f64> {
        self.override_enabled.then_some(self.generation_probability)
    }

    pub fn show(&mut self, ui: &mut egui::Ui, shell: &Shell) -> Option<VehicleAction> {
        let action = self.show_actions(ui, shell);
        self.show_generation(ui, shell);
        action
    }

    pub fn show_actions(&mut self, ui: &mut egui::Ui, shell: &Shell) -> Option<VehicleAction> {
        let mut action = None;
        ui.horizontal_wrapped(|ui| {
            if ui.button(shell.tr("transport.clear", &[])).clicked() {
                action = Some(VehicleAction::Clear);
            }
            if ui.button(shell.tr("transport.fill", &[])).clicked() {
                action = Some(VehicleAction::Fill(self.fill_probability));
            }
            ui.add(
                egui::Slider::new(&mut self.fill_probability, 0.0..=1.0)
                    .text(shell.tr("transport.fillProbability", &[])),
            );
        });
        action
    }

    pub fn show_generation(&mut self, ui: &mut egui::Ui, shell: &Shell) {
        ui.checkbox(
            &mut self.override_enabled,
            shell.tr("transport.globalGeneration", &[]),
        );
        ui.add_enabled(
            self.override_enabled,
            egui::Slider::new(&mut self.generation_probability, 0.0..=1.0)
                .text(shell.tr("transport.generationProbability", &[])),
        );
    }
}
