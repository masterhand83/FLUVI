use super::*;
use crate::parking::EndpointKind;
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
    pick: Option<(usize, EndpointKind)>,
}

impl ParkingForms {
    /// Escape ends only the active cell pick. Other Escape behavior stays unchanged.
    pub(crate) fn cancel_pick_on_escape(&mut self, ctx: &egui::Context) {
        if self.pick.is_some()
            && ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Escape))
        {
            self.cancel_pick();
        }
    }

    pub fn start_pick(&mut self, pair: usize, kind: EndpointKind) -> bool {
        if !self
            .draft
            .as_ref()
            .is_some_and(|d| d.enabled && pair < d.pairs.len())
        {
            return false;
        }
        self.pick = Some((pair, kind));
        self.request = None;
        true
    }

    pub fn picking(&self) -> Option<EndpointKind> {
        self.pick.map(|(_, kind)| kind)
    }

    pub fn cancel_pick(&mut self) {
        self.pick = None;
    }

    pub fn pick_cell(&mut self, cell: CellRef, document: &MapDocument) -> bool {
        let Some((pair, kind)) = self.pick else {
            return false;
        };
        if !document
            .model()
            .streets()
            .get(cell.street)
            .is_some_and(|s| cell.lane < s.config().carriles && cell.index < s.config().tamano)
        {
            return false;
        }
        let Some(pair) = self
            .draft
            .as_mut()
            .filter(|d| d.enabled)
            .and_then(|d| d.pairs.get_mut(pair))
        else {
            self.cancel_pick();
            return false;
        };
        let endpoint = match kind {
            EndpointKind::Entrance => &mut pair.entrance,
            EndpointKind::Exit => &mut pair.exit,
        };
        *endpoint = EndpointDraft::from_cell(cell);
        self.cancel_pick();
        true
    }

    pub fn candidate(&self, document: &MapDocument) -> Result<ParkingRequest, ParkingError> {
        let building = self
            .target
            .ok_or(ParkingError("parking.validation.buildingRequired"))?
            .0;
        let draft = self
            .draft
            .as_ref()
            .ok_or(ParkingError("parking.validation.buildingRequired"))?;
        Ok((building, draft.candidate(document, building)?))
    }

    pub(crate) fn paint_pick(
        &self,
        painter: &egui::Painter,
        frame: &crate::map::MapFrame,
        document: &MapDocument,
        shell: &Shell,
    ) {
        let Some(kind) = self.picking() else { return };
        let painter = painter.with_clip_rect(frame.rect);
        let text = if let Some(preview) = frame.preview {
            painter.add(egui::Shape::convex_polygon(
                preview.corners.to_vec(),
                kind.color().gamma_multiply(0.2),
                egui::Stroke::new(4_f32, egui::Color32::BLACK),
            ));
            for index in 0..4 {
                painter.line_segment(
                    [preview.corners[index], preview.corners[(index + 1) % 4]],
                    egui::Stroke::new(2_f32, kind.color()),
                );
            }
            kind.paint_marker(&painter, preview.rect.center());
            let cell = preview.cell;
            let Some(street) = document.layout().get(cell.street) else {
                return;
            };
            format!(
                "{} {}: {}",
                kind.symbol(),
                shell.tr(kind.label_key(), &[]),
                shell.tr(
                    "parking.ui.pickCell",
                    &[
                        ("street", &street.name),
                        ("lane", &(cell.lane + 1).to_string()),
                        ("cell", &(cell.index + 1).to_string()),
                    ]
                )
            )
        } else {
            shell.tr(kind.pick_hint_key(), &[])
        };
        let galley = painter.layout_no_wrap(text, egui::FontId::proportional(14.), kind.color());
        let position = frame.rect.left_top() + egui::vec2(10., 10.);
        painter.rect_filled(
            egui::Rect::from_min_size(
                position - egui::vec2(5., 4.),
                galley.size() + egui::vec2(10., 8.),
            ),
            3.,
            egui::Color32::from_black_alpha(230),
        );
        painter.galley(position, galley, kind.color());
    }

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
        self.cancel_pick();
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
        self.cancel_pick_on_escape(ui.ctx());
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
        self.cancel_pick_on_escape(ctx);
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
        if self.target.is_none() {
            return;
        }
        let Some(draft) = &mut self.draft else { return };
        ui.checkbox(&mut draft.enabled, shell.tr("parking.ui.enabled", &[]));
        if !draft.enabled {
            self.pick = None;
        }
        let mut new_pick = None;
        if let Some((_, kind)) = self.pick {
            ui.colored_label(kind.color(), shell.tr(kind.pick_hint_key(), &[]));
            if ui.button(shell.tr("parking.ui.cancelPick", &[])).clicked() {
                self.pick = None;
            }
        }
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
                        for (endpoint, kind) in [
                            (&mut pair.entrance, EndpointKind::Entrance),
                            (&mut pair.exit, EndpointKind::Exit),
                        ] {
                            if endpoint_fields(
                                ui,
                                endpoint,
                                document,
                                shell,
                                kind,
                                self.pick == Some((index, kind)),
                            ) {
                                new_pick = Some((index, kind));
                            }
                        }
                    });
                });
            }
            if let Some(index) = remove {
                draft.pairs.remove(index);
                self.pick = None;
                new_pick = None;
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
        let candidate = self.candidate(document);
        if let Err(error) = &candidate {
            ui.colored_label(egui::Color32::RED, shell.tr(error.translation_key(), &[]));
        }
        if ui
            .add_enabled(
                candidate.is_ok() && self.pick.is_none() && new_pick.is_none(),
                egui::Button::new(shell.tr("parking.ui.apply", &[])),
            )
            .clicked()
        {
            self.request = Some(candidate.expect("validated draft"));
        }
        if ui.button(shell.tr("buildings.cancel", &[])).clicked() {
            self.cancel();
            return;
        }
        if let Some((pair, kind)) = new_pick {
            self.start_pick(pair, kind);
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

fn endpoint_fields(
    ui: &mut egui::Ui,
    endpoint: &mut EndpointDraft,
    document: &MapDocument,
    shell: &Shell,
    kind: EndpointKind,
    picking: bool,
) -> bool {
    ui.push_id(kind.label_key(), |ui| {
        ui.colored_label(
            kind.color(),
            format!("{} {}", kind.symbol(), shell.tr(kind.label_key(), &[])),
        );
        let pick = ui
            .add(
                egui::Button::new(shell.tr(
                    match kind {
                        EndpointKind::Entrance => "parking.ui.pickEntry",
                        EndpointKind::Exit => "parking.ui.pickExit",
                    },
                    &[],
                ))
                .selected(picking),
            )
            .clicked();
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
        pick
    })
    .inner
}
