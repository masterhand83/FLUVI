//! Map-first connection editor. No live model changes until its candidate is saved.
use crate::shell::Shell;
use ca_core::{
    connections::{Connection, ConnectionError, Mapping, MergeRow, WeightedRow},
    map_json::MapDocument,
    traffic::LaneDirection,
};
use eframe::egui;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DraftKind {
    #[default]
    Lineal,
    Incorporacion,
    Probabilistica,
}

pub struct DraftRow {
    pub mapping: Mapping,
    pub enabled: bool,
    pub weight: String,
}

#[derive(Default)]
pub struct ConnectionDraft {
    active: bool,
    source: Option<usize>,
    destination: Option<usize>,
    kind: DraftKind,
    rows: Vec<DraftRow>,
}

impl ConnectionDraft {
    pub fn start(&mut self) {
        *self = Self {
            active: true,
            ..Default::default()
        };
    }

    pub fn cancel(&mut self) {
        *self = Self::default();
    }

    pub fn active(&self) -> bool {
        self.active
    }

    pub fn picking(&self) -> bool {
        self.active && self.destination.is_none()
    }

    pub fn rows_mut(&mut self) -> &mut [DraftRow] {
        &mut self.rows
    }

    pub fn preview_mappings(&self) -> impl Iterator<Item = &Mapping> {
        self.rows
            .iter()
            .filter(|r| self.kind != DraftKind::Incorporacion || r.enabled)
            .map(|r| &r.mapping)
    }

    pub fn pick(&mut self, street: usize, document: &MapDocument) {
        if !self.active || street >= document.model().streets().len() {
            return;
        }
        if self.source.is_none() {
            self.source = Some(street);
        } else if self.destination.is_none() {
            self.destination = Some(street);
            self.reset_rows(document);
        }
    }

    pub fn set_kind(&mut self, kind: DraftKind, document: &MapDocument) {
        self.kind = kind;
        self.reset_rows(document);
    }

    fn reset_rows(&mut self, document: &MapDocument) {
        self.rows.clear();
        let (Some(source), Some(destination)) = (self.source, self.destination) else {
            return;
        };
        let streets = document.model().streets();
        let from = &streets[source];
        let to = &streets[destination];
        let count = match self.kind {
            DraftKind::Lineal => 1,
            DraftKind::Incorporacion => from.config().carriles,
            DraftKind::Probabilistica => to.config().carriles,
        };
        for lane in 0..count {
            let source_lane = if self.kind == DraftKind::Incorporacion {
                lane
            } else {
                0
            };
            let destination_lane = lane.min(to.config().carriles - 1);
            self.rows.push(DraftRow {
                mapping: Mapping {
                    source_street: source,
                    source_lane,
                    source_cell: if from.lane_direction(source_lane) == LaneDirection::Reverse {
                        0
                    } else {
                        from.config().tamano as isize - 1
                    },
                    destination_street: destination,
                    destination_lane,
                    destination_cell: if to.lane_direction(destination_lane)
                        == LaneDirection::Reverse
                    {
                        to.config().tamano - 1
                    } else {
                        0
                    },
                },
                enabled: true,
                weight: (1.0 / count as f64).to_string(),
            });
        }
    }

    /// Disabled merge rows are absent at this boundary, including validation.
    pub fn candidate(&self, document: &MapDocument) -> Result<Connection, ConnectionError> {
        if !self.active || self.rows.is_empty() {
            return Err(ConnectionError::InvalidMapping);
        }
        let connection = match self.kind {
            DraftKind::Lineal => Connection::Lineal(self.rows[0].mapping),
            DraftKind::Incorporacion => Connection::Incorporacion(
                self.rows
                    .iter()
                    .filter(|r| r.enabled)
                    .map(|r| MergeRow {
                        mapping: r.mapping,
                        enabled: true,
                    })
                    .collect(),
            ),
            DraftKind::Probabilistica => Connection::Probabilistica(
                self.rows
                    .iter()
                    .map(|r| {
                        Ok(WeightedRow {
                            mapping: r.mapping,
                            weight: r.weight.parse().map_err(|_| ConnectionError::Weights)?,
                        })
                    })
                    .collect::<Result<_, ConnectionError>>()?,
            ),
        };
        document.model().validate_connection(&connection)?;
        Ok(connection)
    }

    /// The caller commits the result through the ordered queue, then cancels the draft.
    /// A full queue leaves the form intact so Save can be retried.
    pub fn show(
        &mut self,
        ctx: &egui::Context,
        map_rect: egui::Rect,
        document: &MapDocument,
        shell: &Shell,
    ) -> Option<Connection> {
        if !self.active {
            return None;
        }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.cancel();
            return None;
        }
        let mut save = false;
        let mut cancel = false;
        egui::Window::new(shell.tr("connectionDraft.title", &[]))
            .id(egui::Id::new("connection-draft"))
            .fixed_pos(map_rect.min + egui::vec2(8.0, 8.0))
            .movable(false)
            .resizable(false)
            .collapsible(false)
            .default_width(320.0)
            .show(ctx, |ui| {
                if self.destination.is_none() {
                    ui.label(shell.tr(
                        if self.source.is_none() {
                            "connectionDraft.pickSource"
                        } else {
                            "connectionDraft.pickDestination"
                        },
                        &[],
                    ));
                }
                if let Some(source) = self.source {
                    ui.label(format!(
                        "{}: {}",
                        shell.tr("connectionDraft.source", &[]),
                        document.layout()[source].name
                    ));
                }
                if let (Some(source), Some(destination)) = (self.source, self.destination) {
                    ui.label(format!(
                        "{}: {}",
                        shell.tr("connectionDraft.destination", &[]),
                        document.layout()[destination].name
                    ));
                    let old = self.kind;
                    egui::ComboBox::from_id_salt("connection-kind")
                        .selected_text(shell.tr(self.kind.key(), &[]))
                        .show_ui(ui, |ui| {
                            for kind in [
                                DraftKind::Lineal,
                                DraftKind::Incorporacion,
                                DraftKind::Probabilistica,
                            ] {
                                ui.selectable_value(
                                    &mut self.kind,
                                    kind,
                                    shell.tr(kind.key(), &[]),
                                );
                            }
                        });
                    if self.kind != old {
                        self.reset_rows(document);
                    }
                    ui.small(shell.tr("connectionDraft.indexHint", &[]));
                    egui::ScrollArea::vertical()
                        .max_height((map_rect.height() - 270.0).max(100.0))
                        .show(ui, |ui| {
                            let streets = document.model().streets();
                            let mut remove = None;
                            for (index, row) in self.rows.iter_mut().enumerate() {
                                ui.push_id(index, |ui| {
                                    ui.separator();
                                    if self.kind == DraftKind::Incorporacion {
                                        ui.checkbox(
                                            &mut row.enabled,
                                            shell.tr("connectionDraft.enableLane", &[]),
                                        );
                                    }
                                    ui.add_enabled_ui(row.enabled, |ui| {
                                        // Weighted destinations share the first row's source.
                                        if self.kind != DraftKind::Probabilistica || index == 0 {
                                            endpoint(
                                                ui,
                                                shell,
                                                "connectionDraft.source",
                                                &streets[source],
                                                &mut row.mapping.source_lane,
                                                &mut row.mapping.source_cell,
                                                true,
                                                self.kind != DraftKind::Incorporacion,
                                            );
                                        }
                                        let mut cell = row.mapping.destination_cell as isize;
                                        endpoint(
                                            ui,
                                            shell,
                                            "connectionDraft.destination",
                                            &streets[destination],
                                            &mut row.mapping.destination_lane,
                                            &mut cell,
                                            false,
                                            true,
                                        );
                                        row.mapping.destination_cell = cell as usize;
                                        if self.kind == DraftKind::Probabilistica {
                                            ui.horizontal(|ui| {
                                                ui.label(shell.tr("connectionDraft.weight", &[]));
                                                ui.add(
                                                    egui::TextEdit::singleline(&mut row.weight)
                                                        .desired_width(65.0),
                                                );
                                                if ui
                                                    .small_button(
                                                        shell.tr("connectionDraft.remove", &[]),
                                                    )
                                                    .clicked()
                                                {
                                                    remove = Some(index);
                                                }
                                            });
                                        }
                                    });
                                });
                            }
                            if let Some(index) = remove {
                                self.rows.remove(index);
                            }
                        });
                    if self.kind == DraftKind::Probabilistica {
                        if let Some(first) = self.rows.first().map(|r| r.mapping) {
                            for row in &mut self.rows {
                                row.mapping.source_lane = first.source_lane;
                                row.mapping.source_cell = first.source_cell;
                            }
                        }
                        if ui
                            .button(shell.tr("connectionDraft.addDestination", &[]))
                            .clicked()
                        {
                            if self.rows.is_empty() {
                                self.reset_rows(document);
                            } else {
                                self.rows.push(DraftRow {
                                    mapping: self.rows[0].mapping,
                                    enabled: true,
                                    weight: "0".into(),
                                });
                            }
                        }
                    }
                    let candidate = self.candidate(document);
                    if let Err(error) = &candidate {
                        ui.colored_label(
                            egui::Color32::RED,
                            shell.tr(error.translation_key(), &[]),
                        );
                    }
                    save = ui
                        .add_enabled(
                            candidate.is_ok(),
                            egui::Button::new(shell.tr("connectionDraft.save", &[])),
                        )
                        .clicked();
                }
                cancel = ui.button(shell.tr("connectionDraft.cancel", &[])).clicked();
            });
        if cancel {
            self.cancel();
        }
        save.then(|| self.candidate(document).ok()).flatten()
    }
}

impl DraftKind {
    fn key(self) -> &'static str {
        match self {
            Self::Lineal => "connectionDraft.lineal",
            Self::Incorporacion => "connectionDraft.incorporacion",
            Self::Probabilistica => "connectionDraft.probabilistica",
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn endpoint(
    ui: &mut egui::Ui,
    shell: &Shell,
    label: &str,
    street: &ca_core::traffic::Calle,
    lane: &mut usize,
    cell: &mut isize,
    source: bool,
    editable_lane: bool,
) {
    ui.horizontal(|ui| {
        ui.label(shell.tr(label, &[]));
        let mut number = *lane + 1;
        let changed = ui
            .add_enabled(
                editable_lane,
                egui::DragValue::new(&mut number)
                    .range(1..=street.config().carriles)
                    .prefix(shell.tr("connectionDraft.lane", &[])),
            )
            .changed();
        *lane = number - 1;
        if changed {
            let reverse = street.lane_direction(*lane) == LaneDirection::Reverse;
            *cell = if source != reverse {
                street.config().tamano as isize - 1
            } else {
                0
            };
        }
        ui.add(
            egui::DragValue::new(cell)
                .range(if source { -1 } else { 0 }..=street.config().tamano as isize - 1)
                .prefix(shell.tr("connectionDraft.cell", &[])),
        );
    });
}
