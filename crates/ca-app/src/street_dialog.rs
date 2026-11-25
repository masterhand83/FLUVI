//! Legacy form adapter. Creation uses the same document factory as map drawing.
use crate::{inspector::geometry_error_message, shell::Shell};
use ca_core::{
    map_json::MapDocument,
    streets::{StreetDefinition, StreetDraft, StreetEdit, StreetError},
    traffic::CalleType,
};
use eframe::egui;

pub struct StreetDialog {
    open: bool,
    values: [String; 8],
    tipo: CalleType,
    error: Option<StreetError>,
}

impl Default for StreetDialog {
    fn default() -> Self {
        Self {
            open: false,
            values: ["Street 1", "0", "0", "0", "10", "1", "10", "2"].map(str::to_owned),
            tipo: CalleType::Conexion,
            error: None,
        }
    }
}

impl StreetDialog {
    pub fn open(&mut self) {
        self.open = true;
    }
    pub fn close(&mut self) {
        self.open = false;
        self.error = None;
    }
    pub fn is_open(&self) -> bool {
        self.open
    }

    fn creation(&self) -> Result<StreetEdit, StreetError> {
        let number = |i: usize, key| self.values[i].parse::<f64>().map_err(|_| StreetError(key));
        let integer = |i: usize, key| {
            self.values[i]
                .parse::<usize>()
                .map_err(|_| StreetError(key))
        };
        let angle = number(3, "streetInspector.errors.geometry")?;
        if !(0.0..=360.0).contains(&angle) {
            return Err(StreetError("streetDialog.angleRange"));
        }
        Ok(StreetEdit::Create(StreetDefinition {
            name: self.values[0].trim().into(),
            draft: StreetDraft {
                origin: [
                    number(1, "streetInspector.errors.geometry")? / 5.0,
                    number(2, "streetInspector.errors.geometry")? / 5.0,
                ],
                angle_degrees: angle,
                cells: integer(4, "streetInspector.errors.length")?,
            },
            lanes: integer(5, "streetInspector.errors.lanes")?,
            tipo: self.tipo,
            generation: if self.tipo == CalleType::Generador {
                number(6, "streetDialog.probabilityRange")? / 100.0
            } else {
                0.0
            },
            lane_change: number(7, "streetDialog.probabilityRange")? / 100.0,
        }))
    }

    pub fn show(
        &mut self,
        ctx: &egui::Context,
        document: &MapDocument,
        shell: &Shell,
    ) -> Option<StreetEdit> {
        if !self.open {
            return None;
        }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.close();
            return None;
        }
        let mut open = self.open;
        let mut submit = false;
        let mut cancel = false;
        egui::Window::new(shell.tr("streetDialog.title", &[]))
            .id(egui::Id::new("new-street"))
            .open(&mut open)
            .resizable(false)
            .show(ctx, |ui| {
                egui::Grid::new("new-street-fields")
                    .num_columns(2)
                    .show(ui, |ui| {
                        for (i, key) in [
                            "streetInspector.name",
                            "streetInspector.x",
                            "streetInspector.y",
                            "streetInspector.angle",
                            "streetInspector.length",
                            "streetInspector.lanes",
                            "streetDialog.generation",
                            "streetDialog.laneChange",
                        ]
                        .iter()
                        .enumerate()
                        {
                            if i == 6 && self.tipo != CalleType::Generador {
                                continue;
                            }
                            ui.label(shell.tr(key, &[]));
                            ui.add(
                                egui::TextEdit::singleline(&mut self.values[i])
                                    .desired_width(150.0),
                            );
                            ui.end_row();
                        }
                        ui.label(shell.tr("streetInspector.type", &[]));
                        egui::ComboBox::from_id_salt("new-street-type")
                            .selected_text(crate::inspector::type_label(shell, self.tipo))
                            .show_ui(ui, |ui| {
                                for tipo in [
                                    CalleType::Generador,
                                    CalleType::Conexion,
                                    CalleType::Devorador,
                                ] {
                                    ui.selectable_value(
                                        &mut self.tipo,
                                        tipo,
                                        crate::inspector::type_label(shell, tipo),
                                    );
                                }
                            });
                        ui.end_row();
                    });
                if let Some(error) = self.error {
                    ui.colored_label(egui::Color32::RED, geometry_error_message(shell, error));
                }
                ui.horizontal(|ui| {
                    submit = ui.button(shell.tr("streetDialog.create", &[])).clicked();
                    cancel = ui.button(shell.tr("streetSession.cancel", &[])).clicked();
                });
            });
        self.open = open && !cancel;
        if submit {
            match self.creation().and_then(|edit| {
                document.validate_street_edit(&edit)?;
                Ok(edit)
            }) {
                Ok(edit) => {
                    self.error = None;
                    return Some(edit);
                }
                Err(error) => self.error = Some(error),
            }
        }
        None
    }
}
