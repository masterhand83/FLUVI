//! Lane-only bulk form. The document validates the complete batch.
use crate::{inspector::geometry_error_message, shell::Shell};
use ca_core::{
    map_json::MapDocument,
    streets::{StreetEdit, StreetError},
    traffic::LaneDirection,
};
use eframe::egui;

#[derive(Default)]
pub struct BulkEditor {
    selected: Vec<usize>,
    lanes: String,
    directions: Vec<LaneDirection>,
    error: Option<StreetError>,
}

#[derive(Default)]
pub struct BulkResponse {
    pub edit: Option<StreetEdit>,
    pub closed: bool,
}

impl BulkEditor {
    pub fn show(
        &mut self,
        ctx: &egui::Context,
        document: &MapDocument,
        selected: &[usize],
        shell: &Shell,
    ) -> BulkResponse {
        let mut result = BulkResponse::default();
        if self.selected != selected {
            self.selected = selected.to_vec();
            self.error = None;
            if let Some(street) = selected
                .first()
                .and_then(|&id| document.model().streets().get(id))
            {
                self.lanes = street.config().carriles.to_string();
                self.directions = (0..street.config().carriles)
                    .map(|lane| street.lane_direction(lane))
                    .collect();
                self.directions.resize(10, LaneDirection::Forward);
            }
        }
        if selected.is_empty() {
            return result;
        }
        let mut open = true;
        let mut apply = false;
        egui::Window::new(shell.tr("bulkStreetEditor.title", &[]))
            .id(egui::Id::new("bulk-street-editor"))
            .open(&mut open)
            .resizable(false)
            .show(ctx, |ui| {
                ui.label(shell.tr(
                    "bulkStreetEditor.selected",
                    &[("count", &selected.len().to_string())],
                ));
                ui.label(shell.tr("streetInspector.lanes", &[]));
                ui.text_edit_singleline(&mut self.lanes);
                let visible = self.lanes.parse::<usize>().unwrap_or(0).min(10);
                for (lane, direction) in self.directions.iter_mut().take(visible).enumerate() {
                    ui.push_id(lane, |ui| {
                        ui.label(shell.tr(
                            "streetInspector.lane",
                            &[("number", &(lane + 1).to_string())],
                        ));
                        egui::ComboBox::from_id_salt("bulk-direction")
                            .selected_text(shell.tr(
                                if *direction == LaneDirection::Forward {
                                    "streetInspector.forward"
                                } else {
                                    "streetInspector.reverse"
                                },
                                &[],
                            ))
                            .show_ui(ui, |ui| {
                                for (value, key) in [
                                    (LaneDirection::Forward, "streetInspector.forward"),
                                    (LaneDirection::Reverse, "streetInspector.reverse"),
                                ] {
                                    ui.selectable_value(direction, value, shell.tr(key, &[]));
                                }
                            });
                    });
                }
                if let Some(error) = self.error {
                    ui.colored_label(egui::Color32::RED, geometry_error_message(shell, error));
                }
                apply = ui.button(shell.tr("bulkStreetEditor.apply", &[])).clicked();
            });
        result.closed = !open || ctx.input(|i| i.key_pressed(egui::Key::Escape));
        if apply && !result.closed {
            let edit = self
                .lanes
                .parse::<usize>()
                .map_err(|_| StreetError("streetInspector.errors.lanes"))
                .and_then(|lanes| {
                    if !(1..=10).contains(&lanes) {
                        return Err(StreetError("streetInspector.errors.lanes"));
                    }
                    let edit = StreetEdit::Bulk {
                        streets: selected.to_vec(),
                        lanes,
                        directions: self.directions[..lanes].to_vec(),
                    };
                    document.validate_street_edit(&edit)?;
                    Ok(edit)
                });
            match edit {
                Ok(edit) => {
                    self.error = None;
                    result.edit = Some(edit);
                }
                Err(error) => self.error = Some(error),
            }
        }
        result
    }
}
