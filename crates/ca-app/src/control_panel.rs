//! Non-transport tools live in their control-panel sections.
use crate::{
    connections::ConnectionOverlays, map::MapInteraction, shell::Shell,
    transport::TransportControls,
};
use ca_core::map_json::MapDocument;
use eframe::egui;

pub enum PanelAction {
    BuildingTool(crate::buildings::Tool),
    NewBuilding,
    ScenarioTime,
    Profiles,
    Connection,
    NewConnection,
    SavedConnection(crate::connections::SavedConnectionAction),
    NewStreet,
    Open,
    Save,
    New,
}

pub struct ControlPanel<'a> {
    pub document: &'a MapDocument,
    pub map: Option<&'a mut MapInteraction>,
    pub connections: Option<&'a mut ConnectionOverlays>,
    pub saved_connections: &'a mut crate::connections::SavedConnections,
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
                    for (tool, key) in [
                        (crate::buildings::Tool::Rectangle, "buildings.rectangle"),
                        (crate::buildings::Tool::Polygon, "buildings.polygon"),
                    ] {
                        if ui.button(shell.tr(key, &[])).clicked() {
                            action = Some(PanelAction::BuildingTool(tool));
                        }
                    }
                    if ui.button(shell.tr("clock.setTime", &[])).clicked() {
                        action = Some(PanelAction::ScenarioTime);
                    }
                    if ui.button(shell.tr("clock.profiles", &[])).clicked() {
                        action = Some(PanelAction::Profiles);
                    }
                    if ui.button(shell.tr("connectionDraft.button", &[])).clicked() {
                        action = Some(PanelAction::Connection);
                    }
                    if let Some(map) = &mut self.map {
                        map.show_tools(ui, shell);
                    }
                    if let Some(connections) = &mut self.connections {
                        connections.show_toggle(ui, shell);
                    }
                    ui.label(shell.tr("shell.profiler", &[]));
                }
                "constructor" => {
                    if ui.button(shell.tr("buildings.new", &[])).clicked() {
                        action = Some(PanelAction::NewBuilding);
                    }
                    if ui.button(shell.tr("streetDialog.title", &[])).clicked() {
                        action = Some(PanelAction::NewStreet);
                    }
                    if ui
                        .button(shell.tr("savedConnections.newTitle", &[]))
                        .clicked()
                    {
                        action = Some(PanelAction::NewConnection);
                    }
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
                    if let Some(value) = self.saved_connections.show(ui, self.document, shell) {
                        action = Some(PanelAction::SavedConnection(value));
                    }
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
