//! Non-transport tools live in their control-panel sections.
use crate::{
    connections::ConnectionOverlays, map::MapInteraction, shell::Shell,
    transport::TransportControls,
};
use ca_core::map_json::MapDocument;
use eframe::egui;

pub enum PanelAction {
    Open,
    Save,
    New,
}

pub struct ControlPanel<'a> {
    pub document: &'a MapDocument,
    pub map: Option<&'a mut MapInteraction>,
    pub connections: Option<&'a mut ConnectionOverlays>,
    pub transport: &'a mut TransportControls,
    pub enabled: bool,
    pub files_ready: bool,
}

impl ControlPanel<'_> {
    pub fn show(mut self, ctx: &egui::Context, shell: &mut Shell) -> Option<PanelAction> {
        let mut action = None;
        shell.sidebar_with(ctx, |section, ui, shell| {
            ui.add_enabled_ui(self.enabled, |ui| match section {
                "tools" => {
                    if let Some(map) = &mut self.map {
                        map.show_tools(ui, shell);
                    }
                    if let Some(connections) = &mut self.connections {
                        connections.show_toggle(ui, shell);
                    }
                    ui.label(shell.tr("shell.profiler", &[]));
                }
                "constructor" => {
                    ui.label(if self.document.name().is_empty() {
                        shell.tr("mapFiles.untitled", &[])
                    } else {
                        self.document.name().to_owned()
                    });
                    ui.add_enabled_ui(self.files_ready, |ui| {
                        for (key, value) in [
                            ("mapFiles.open", PanelAction::Open),
                            ("mapFiles.save", PanelAction::Save),
                            ("mapFiles.new", PanelAction::New),
                        ] {
                            if ui.button(shell.tr(key, &[])).clicked() {
                                action = Some(value);
                            }
                        }
                    });
                }
                "streetSettings" => {
                    if let Some(map) = &mut self.map {
                        map.show_selector(ui, shell);
                    }
                    self.transport.show_generation(ui, shell);
                }
                _ => {}
            });
        });
        action
    }
}
