//! Map-first connection editor. No live model changes until its candidate is saved.
use crate::shell::Shell;
use ca_core::{
    cell_index::CellRef,
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
    pub probability: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PickPreview {
    Source(CellRef),
    Link {
        source: CellRef,
        target: Option<CellRef>,
    },
}

#[derive(Default)]
pub struct ConnectionDraft {
    active: bool,
    source: Option<CellRef>,
    destination: Option<CellRef>,
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

    pub fn color(&self) -> egui::Color32 {
        self.kind.color()
    }

    /// A map guide is separate from the editable rows and cannot finish a pick.
    pub fn preview_pick(
        &self,
        hovered: Option<CellRef>,
        document: &MapDocument,
    ) -> Option<PickPreview> {
        if !self.picking() {
            return None;
        }
        let hovered = hovered.filter(|&cell| valid_cell(cell, document));
        let source = self.source.or(hovered)?;
        let source = if self.kind == DraftKind::Probabilistica {
            source
        } else {
            CellRef {
                index: directional_cell(
                    &document.model().streets()[source.street],
                    source.lane,
                    true,
                ),
                ..source
            }
        };
        if self.source.is_none() {
            return Some(PickPreview::Source(source));
        }
        let target = hovered.map(|cell| {
            if self.kind == DraftKind::Lineal {
                CellRef {
                    index: directional_cell(
                        &document.model().streets()[cell.street],
                        cell.lane,
                        false,
                    ),
                    ..cell
                }
            } else {
                cell
            }
        });
        Some(PickPreview::Link { source, target })
    }

    pub fn rows_mut(&mut self) -> &mut [DraftRow] {
        &mut self.rows
    }

    pub fn preview_mappings<'a>(
        &'a self,
        document: &'a MapDocument,
    ) -> impl Iterator<Item = Mapping> + 'a {
        self.rows
            .iter()
            .filter(|r| self.kind != DraftKind::Incorporacion || r.enabled)
            .map(|r| self.normalized_mapping(r.mapping, document))
    }

    fn normalized_mapping(&self, mut mapping: Mapping, document: &MapDocument) -> Mapping {
        let streets = document.model().streets();
        if matches!(self.kind, DraftKind::Lineal | DraftKind::Incorporacion)
            && let Some(source) = streets.get(mapping.source_street)
            && mapping.source_lane < source.config().carriles
        {
            mapping.source_cell = directional_cell(source, mapping.source_lane, true) as isize;
        }
        if self.kind == DraftKind::Lineal
            && let Some(destination) = streets.get(mapping.destination_street)
            && mapping.destination_lane < destination.config().carriles
        {
            mapping.destination_cell =
                directional_cell(destination, mapping.destination_lane, false);
        }
        mapping
    }

    pub fn pick(&mut self, street: usize, document: &MapDocument) {
        let Some(road) = document.model().streets().get(street) else {
            return;
        };
        self.pick_cell(
            CellRef {
                street,
                lane: 0,
                index: directional_cell(road, 0, self.source.is_none()),
            },
            document,
        );
    }

    pub fn pick_cell(&mut self, cell: CellRef, document: &MapDocument) {
        if !self.active || !valid_cell(cell, document) {
            return;
        }
        if self.source.is_none() {
            self.source = Some(cell);
        } else if self.destination.is_none() {
            self.destination = Some(cell);
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
        let from = &streets[source.street];
        let to = &streets[destination.street];
        let count = match self.kind {
            DraftKind::Lineal => 1,
            DraftKind::Incorporacion => from.config().carriles,
            DraftKind::Probabilistica => to.config().carriles,
        };
        for lane in 0..count {
            let source_lane = if self.kind == DraftKind::Incorporacion {
                lane
            } else {
                source.lane
            };
            let selected_target = match self.kind {
                DraftKind::Lineal => true,
                DraftKind::Incorporacion => lane == source.lane,
                DraftKind::Probabilistica => lane == destination.lane,
            };
            let destination_lane = if selected_target {
                destination.lane
            } else {
                lane.min(to.config().carriles - 1)
            };
            self.rows.push(DraftRow {
                mapping: Mapping {
                    source_street: source.street,
                    source_lane,
                    source_cell: if self.kind == DraftKind::Probabilistica {
                        source.index
                    } else {
                        directional_cell(from, source_lane, true)
                    } as isize,
                    destination_street: destination.street,
                    destination_lane,
                    destination_cell: if selected_target && self.kind != DraftKind::Lineal {
                        destination.index
                    } else {
                        directional_cell(to, destination_lane, false)
                    },
                },
                enabled: true,
                probability: (100.0 / count as f64).to_string(),
            });
        }
    }

    /// Disabled merge rows are absent at this boundary, including validation.
    pub fn candidate(&self, document: &MapDocument) -> Result<Connection, ConnectionError> {
        if !self.active || self.rows.is_empty() {
            return Err(ConnectionError::InvalidMapping);
        }
        let connection = match self.kind {
            DraftKind::Lineal => {
                Connection::Lineal(self.normalized_mapping(self.rows[0].mapping, document))
            }
            DraftKind::Incorporacion => Connection::Incorporacion(
                self.rows
                    .iter()
                    .filter(|r| r.enabled)
                    .map(|r| MergeRow {
                        mapping: self.normalized_mapping(r.mapping, document),
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
                            weight: r
                                .probability
                                .parse::<f64>()
                                .map_err(|_| ConnectionError::Weights)?
                                / 100.0,
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
                        document.layout()[source.street].name
                    ));
                }
                let old = self.kind;
                egui::ComboBox::from_id_salt("connection-kind")
                    .selected_text(
                        egui::RichText::new(shell.tr(self.kind.key(), &[])).color(self.color()),
                    )
                    .show_ui(ui, |ui| {
                        for kind in [
                            DraftKind::Lineal,
                            DraftKind::Incorporacion,
                            DraftKind::Probabilistica,
                        ] {
                            ui.selectable_value(
                                &mut self.kind,
                                kind,
                                egui::RichText::new(shell.tr(kind.key(), &[])).color(kind.color()),
                            );
                        }
                    });
                if self.kind != old {
                    self.reset_rows(document);
                }
                if let (Some(source), Some(destination)) = (self.source, self.destination) {
                    ui.label(format!(
                        "{}: {}",
                        shell.tr("connectionDraft.destination", &[]),
                        document.layout()[destination.street].name
                    ));
                    if self.kind != DraftKind::Probabilistica {
                        ui.small(shell.tr(
                            if self.kind == DraftKind::Lineal {
                                "connectionDraft.linearHint"
                            } else {
                                "connectionDraft.incorporationHint"
                            },
                            &[],
                        ));
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
                                                &streets[source.street],
                                                &mut row.mapping.source_lane,
                                                &mut row.mapping.source_cell,
                                                true,
                                                self.kind != DraftKind::Probabilistica,
                                            );
                                        }
                                        let mut cell = row.mapping.destination_cell as isize;
                                        endpoint(
                                            ui,
                                            shell,
                                            &streets[destination.street],
                                            &mut row.mapping.destination_lane,
                                            &mut cell,
                                            false,
                                            self.kind == DraftKind::Lineal,
                                        );
                                        row.mapping.destination_cell = cell as usize;
                                        if self.kind == DraftKind::Probabilistica {
                                            ui.horizontal(|ui| {
                                                ui.label(
                                                    shell.tr("connectionDraft.probability", &[]),
                                                );
                                                ui.add(
                                                    egui::TextEdit::singleline(
                                                        &mut row.probability,
                                                    )
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
                                    probability: "0".into(),
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
    fn color(self) -> egui::Color32 {
        crate::connections::connection_color(match self {
            Self::Lineal => ca_core::connections::ConnectionKind::Linear,
            Self::Incorporacion => ca_core::connections::ConnectionKind::Incorporation,
            Self::Probabilistica => ca_core::connections::ConnectionKind::Probabilistic,
        })
    }
    fn key(self) -> &'static str {
        match self {
            Self::Lineal => "connectionDraft.lineal",
            Self::Incorporacion => "connectionDraft.incorporacion",
            Self::Probabilistica => "connectionDraft.probabilistica",
        }
    }
}

fn endpoint(
    ui: &mut egui::Ui,
    shell: &Shell,
    street: &ca_core::traffic::Calle,
    lane: &mut usize,
    cell: &mut isize,
    source: bool,
    fixed_cell: bool,
) {
    ui.horizontal(|ui| {
        ui.label(shell.tr(
            if source {
                "connectionDraft.source"
            } else {
                "connectionDraft.destination"
            },
            &[],
        ));
        let mut number = *lane + 1;
        let changed = ui
            .add(
                egui::DragValue::new(&mut number)
                    .range(1..=street.config().carriles)
                    .prefix(shell.tr("connectionDraft.lane", &[]))
                    .update_while_editing(true),
            )
            .changed();
        *lane = number - 1;
        if changed || fixed_cell {
            *cell = directional_cell(street, *lane, source) as isize;
        }
        if fixed_cell {
            ui.label(format!("{}{cell}", shell.tr("connectionDraft.cell", &[])));
        } else {
            ui.add(
                egui::DragValue::new(cell)
                    .range(if source { -1 } else { 0 }..=street.config().tamano as isize - 1)
                    .prefix(shell.tr("connectionDraft.cell", &[]))
                    .update_while_editing(true),
            );
        }
    });
}

fn directional_cell(street: &ca_core::traffic::Calle, lane: usize, source: bool) -> usize {
    if source != (street.lane_direction(lane) == LaneDirection::Reverse) {
        street.config().tamano - 1
    } else {
        0
    }
}

fn valid_cell(cell: CellRef, document: &MapDocument) -> bool {
    document
        .model()
        .streets()
        .get(cell.street)
        .is_some_and(|street| {
            cell.lane < street.config().carriles && cell.index < street.config().tamano
        })
}
