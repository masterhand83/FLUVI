use super::*;
use crate::shell::Shell;
use eframe::egui;

pub type ParkingRequest = (usize, Option<ParkingConfig>);

#[derive(Default)]
pub struct ParkingForms {
    target: Option<(usize, u64)>,
    topology: Vec<(String, usize, usize)>,
    draft: Option<ParkingDraft>,
    dialog: bool,
    request: Option<ParkingRequest>,
}

impl ParkingForms {
    /// A topology change discards stale physical addresses.
    pub fn select(&mut self, document: &MapDocument, building: Option<usize>, revision: u64) {
        let target = building
            .filter(|i| *i < document.buildings().len())
            .map(|i| (i, revision));
        if target != self.target {
            let topology = document
                .layout()
                .iter()
                .zip(document.model().streets())
                .map(|(placement, street)| {
                    (
                        placement.name.clone(),
                        street.config().carriles,
                        street.config().tamano,
                    )
                })
                .collect::<Vec<_>>();
            if target.map(|t| t.0) != self.target.map(|t| t.0) || topology != self.topology {
                self.cancel();
            }
            self.topology = topology;
        }
        self.target = target;
        if self.draft.is_none() {
            self.draft = target.map(|(i, _)| ParkingDraft::new(document, i));
        }
    }

    pub fn cancel(&mut self) {
        self.draft = None;
        self.dialog = false;
        self.request = None;
    }

    pub fn has_draft(&self) -> bool {
        self.draft.is_some()
    }

    pub fn open_dialog(&mut self) {
        self.dialog = self.draft.is_some();
    }

    pub fn take_request(&mut self) -> Option<ParkingRequest> {
        self.request.take()
    }

    pub fn inspector(&mut self, ui: &mut egui::Ui, document: &MapDocument, shell: &Shell) {
        if self.dialog {
            return;
        }
        ui.separator();
        ui.heading(shell.tr("parking.ui.title", &[]));
        if ui.button(shell.tr("parking.ui.dialog", &[])).clicked() {
            self.open_dialog();
            return;
        }
        self.fields(ui, document, shell);
    }

    pub fn show_dialog(&mut self, ctx: &egui::Context, document: &MapDocument, shell: &Shell) {
        if !self.dialog {
            return;
        }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.cancel();
            return;
        }
        let mut open = true;
        egui::Window::new(shell.tr("parking.ui.dialog", &[]))
            .id(egui::Id::new("parking_dialog"))
            .open(&mut open)
            .default_width(420.)
            .vscroll(true)
            .show(ctx, |ui| {
                self.fields(ui, document, shell);
            });
        if !open {
            self.cancel();
        }
    }

    fn fields(&mut self, ui: &mut egui::Ui, document: &MapDocument, shell: &Shell) {
        let Some((building, _)) = self.target else {
            return;
        };
        let Some(draft) = &mut self.draft else { return };
        ui.checkbox(&mut draft.enabled, shell.tr("parking.ui.enabled", &[]));
        if draft.enabled {
            ui.label(shell.tr("parking.ui.capacity", &[]));
            ui.add(egui::TextEdit::singleline(&mut draft.capacity).desired_width(80.));
            ui.label(shell.tr("parking.ui.indices", &[]));
            let mut remove = None;
            for (index, pair) in draft.pairs.iter_mut().enumerate() {
                ui.push_id(index, |ui| {
                    ui.group(|ui| {
                        ui.horizontal(|ui| {
                            ui.label(format!(
                                "{} {}",
                                shell.tr("parking.ui.pair", &[]),
                                index + 1
                            ));
                            if ui
                                .small_button(shell.tr("parking.ui.remove", &[]))
                                .clicked()
                            {
                                remove = Some(index);
                            }
                        });
                        endpoint(ui, &mut pair.entrance, document, shell, "parking.ui.entry");
                        endpoint(ui, &mut pair.exit, document, shell, "parking.ui.exit");
                    });
                });
            }
            if let Some(index) = remove {
                draft.pairs.remove(index);
            }
            if ui
                .add_enabled(
                    draft.pairs.len() < 10,
                    egui::Button::new(shell.tr("parking.ui.add", &[])),
                )
                .clicked()
            {
                draft.pairs.push(PairDraft::default());
            }
        }
        let candidate = draft.candidate(document, building);
        if let Err(error) = &candidate {
            ui.colored_label(egui::Color32::RED, shell.tr(error.translation_key(), &[]));
        }
        if ui
            .add_enabled(
                candidate.is_ok(),
                egui::Button::new(shell.tr("parking.ui.apply", &[])),
            )
            .clicked()
        {
            self.request = Some((building, candidate.expect("validated draft")));
        }
        if ui.button(shell.tr("buildings.cancel", &[])).clicked() {
            self.cancel();
            return;
        }
        let draft = self.draft.as_mut().expect("draft remains open");
        if draft.enabled {
            ui.collapsing(shell.tr("parking.ui.curves", &[]), |ui| {
                ui.horizontal_wrapped(|ui| {
                    for (preset, key) in [
                        (Preset::Normal, "parking.ui.normal"),
                        (Preset::Office, "parking.ui.office"),
                        (Preset::Shopping, "parking.ui.shopping"),
                    ] {
                        if ui.button(shell.tr(key, &[])).clicked() {
                            draft.preset(preset);
                        }
                    }
                });
                egui::Grid::new("parking_hours").show(ui, |ui| {
                    ui.label(shell.tr("parking.ui.hour", &[]));
                    ui.label(shell.tr("parking.ui.entryPercent", &[]));
                    ui.label(shell.tr("parking.ui.exitPercent", &[]));
                    ui.end_row();
                    for hour in 0..24 {
                        ui.label(format!("{hour:02}:00"));
                        ui.add(
                            egui::TextEdit::singleline(&mut draft.entry[hour]).desired_width(65.),
                        );
                        ui.add(
                            egui::TextEdit::singleline(&mut draft.exit[hour]).desired_width(65.),
                        );
                        ui.end_row();
                    }
                });
            });
        }
    }
}

fn endpoint(
    ui: &mut egui::Ui,
    endpoint: &mut EndpointDraft,
    document: &MapDocument,
    shell: &Shell,
    key: &str,
) {
    ui.push_id(key, |ui| {
        ui.label(shell.tr(key, &[]));
        egui::ComboBox::from_id_salt("street")
            .selected_text(
                endpoint
                    .street
                    .and_then(|i| document.layout().get(i))
                    .map_or_else(|| shell.tr("parking.ui.street", &[]), |s| s.name.clone()),
            )
            .show_ui(ui, |ui| {
                for i in crate::streets::sorted_streets(document) {
                    ui.selectable_value(&mut endpoint.street, Some(i), &document.layout()[i].name);
                }
            });
        let dimensions = endpoint
            .street
            .and_then(|i| document.model().streets().get(i))
            .map(|s| (s.config().carriles, s.config().tamano));
        ui.horizontal(|ui| {
            ui.label(shell.tr("parking.ui.lane", &[]));
            ui.add(egui::TextEdit::singleline(&mut endpoint.lane).desired_width(45.));
            ui.label(shell.tr("parking.ui.cell", &[]));
            ui.add(egui::TextEdit::singleline(&mut endpoint.cell).desired_width(55.));
        });
        if let Some((lanes, cells)) = dimensions {
            ui.small(format!(
                "{} 1–{lanes}; {} 1–{cells}",
                shell.tr("parking.ui.lane", &[]),
                shell.tr("parking.ui.cell", &[])
            ));
        }
    });
}
