use super::*;
use crate::shell::Shell;
use ca_core::{buildings::PALETTE, camera::WorldView};
use eframe::egui;

fn world(pos: egui::Pos2, rect: egui::Rect, view: WorldView, shift: [f32; 2]) -> [f64; 2] {
    let local = pos - rect.min;
    let fraction = [local.x / rect.width(), local.y / rect.height()];
    std::array::from_fn(|i| ((view.origin[i] + fraction[i] * view.span[i]) - shift[i]) as f64 * 5.)
}

fn screen(point: [f64; 2], rect: egui::Rect, view: WorldView, shift: [f32; 2]) -> egui::Pos2 {
    rect.min
        + egui::vec2(
            (point[0] as f32 / 5. + shift[0] - view.origin[0]) / view.span[0] * rect.width(),
            (point[1] as f32 / 5. + shift[1] - view.origin[1]) / view.span[1] * rect.height(),
        )
}

fn handles(building: &Building) -> impl Iterator<Item = (Handle, [f64; 2])> + '_ {
    let [min, max] = if building.vertices.is_some() {
        building.bounds()
    } else {
        [[0.; 2]; 2]
    };
    let corners = if building.vertices.is_some() {
        [
            [min[0], min[1]],
            [max[0], min[1]],
            [max[0], max[1]],
            [min[0], max[1]],
        ]
    } else {
        building.corners()
    };
    building
        .vertices
        .iter()
        .flatten()
        .copied()
        .enumerate()
        .map(|(i, p)| (Handle::Vertex(i), p))
        .chain(
            corners
                .into_iter()
                .enumerate()
                .map(|(i, p)| (Handle::Corner(i), p)),
        )
        .chain([
            (Handle::Move, building.center),
            (
                Handle::Rotate,
                rotate(
                    [
                        building.center[0],
                        building.center[1] - building.size[1] / 2. - 20.,
                    ],
                    building.center,
                    building.display_angle(),
                ),
            ),
        ])
}

impl BuildingEditor {
    pub fn upload_image(&mut self, ctx: &egui::Context, shell: &Shell, target: Option<usize>) {
        match crate::building_images::start(
            crate::building_images::Source::FileDialog(shell.tr("buildings.upload", &[])),
            ctx.clone(),
        ) {
            Ok(receiver) => self.begin_image_load(receiver, target),
            Err(_) => self.error = Some(BuildingError("imageDecode")),
        }
    }

    pub fn delete_shortcut(
        &mut self,
        ctx: &egui::Context,
        document: &MapDocument,
        shell: &mut Shell,
    ) {
        if self.parking_picking() {
            return;
        }
        if let Some(index) = self.selected
            && !ctx.wants_keyboard_input()
            && self.delete_answer.is_none()
            && ctx.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Delete))
        {
            self.request_delete();
            self.delete_answer = Some(shell.confirm(
                shell.tr("buildings.delete", &[]),
                shell.tr(
                    "buildings.deleteConfirm",
                    &[("name", &document.buildings()[index].label)],
                ),
            ));
        }
    }
    /// Called before map input. Only building gestures consume map input.
    pub fn captures(
        &self,
        ctx: &egui::Context,
        document: &MapDocument,
        rect: egui::Rect,
        view: WorldView,
        shift: [f32; 2],
    ) -> bool {
        if self.active() {
            return true;
        }
        if ctx.input(|i| i.modifiers.shift) {
            return false;
        }
        if self.form.is_some() {
            return false;
        }
        let pointer = ctx.input(|i| i.pointer.clone());
        if !pointer.primary_pressed() {
            return false;
        }
        let Some(pos) = pointer.interact_pos().filter(|p| rect.contains(*p)) else {
            return false;
        };
        self.hit_handle(document, pos, rect, view, shift).is_some()
            || document
                .buildings()
                .iter()
                .any(|b| b.contains(world(pos, rect, view, shift)))
    }

    fn hit_handle(
        &self,
        document: &MapDocument,
        pos: egui::Pos2,
        rect: egui::Rect,
        view: WorldView,
        shift: [f32; 2],
    ) -> Option<Handle> {
        let building = self
            .preview
            .as_ref()
            .or_else(|| self.selected.and_then(|i| document.buildings().get(i)))?;
        handles(building)
            .find_map(|(h, p)| (screen(p, rect, view, shift).distance(pos) < 9.).then_some(h))
    }

    pub fn input(
        &mut self,
        ui: &egui::Ui,
        document: &MapDocument,
        rect: egui::Rect,
        view: WorldView,
        shift: [f32; 2],
    ) -> Option<BuildingEdit> {
        if self.parking_picking() {
            return None;
        }
        if ui.input(|i| {
            i.key_pressed(egui::Key::Escape)
                || (!i.focused && self.image_job.is_none() && self.tool != Some(Tool::Image))
        }) {
            self.cancel();
            self.form = None;
            return None;
        }
        if !ui.input(|i| i.focused) {
            return None;
        }
        if self.form.is_some() {
            return None;
        }
        let pointer = ui.input(|i| i.pointer.clone());
        let pos = pointer.interact_pos()?;
        let over = rect.contains(pos) && ui.rect_contains_pointer(rect);
        let point = world(pos, rect, view, shift);
        if pointer.primary_pressed() && over {
            match self.tool {
                Some(Tool::Rectangle) => self.rectangle_start(point),
                Some(Tool::Polygon) => {
                    if self.vertices.len() >= 3
                        && screen(self.vertices[0], rect, view, shift).distance(pos) < 9.
                    {
                        return self.finish_polygon();
                    }
                    self.push_vertex(point);
                }
                Some(Tool::Image) => return self.place_image(point),
                None => {
                    if self.image_job.is_some() {
                        return None;
                    }
                    if let Some(handle) = self.hit_handle(document, pos, rect, view, shift) {
                        self.begin_drag(document, self.selected?, handle, point);
                    } else if let Some(index) =
                        document.buildings().iter().rposition(|b| b.contains(point))
                    {
                        self.begin_drag(document, index, Handle::Move, point);
                    } else {
                        self.select(None);
                    }
                }
            }
        }
        if self.drag.is_some() && (pointer.primary_down() || pointer.primary_released()) {
            self.drag_to(point, ui.input(|i| i.modifiers.shift));
            if pointer.primary_released() {
                return self.finish_drag();
            }
        }
        if self.tool == Some(Tool::Polygon) && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
            return self.finish_polygon();
        }
        None
    }

    pub fn forms(
        &mut self,
        ctx: &egui::Context,
        document: &MapDocument,
        shell: &mut Shell,
    ) -> Option<BuildingEdit> {
        self.parking_form.cancel_pick_on_escape(ctx);
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.cancel();
            self.form = None;
            self.select(None);
        }
        if let Some(answer) = &self.delete_answer
            && let Ok(accepted) = answer.try_recv()
        {
            self.delete_answer = None;
            if let Some(edit) = self.answer_delete(accepted) {
                return Some(edit);
            }
        }
        let mut edit = self.poll_image(document);
        if self.image_job.is_some()
            || self.tool == Some(Tool::Image)
            || (self.error.is_some()
                && self.selected.is_none()
                && self.tool.is_none()
                && self.form.is_none())
        {
            egui::Window::new(shell.tr("buildings.upload", &[]))
                .id(egui::Id::new("image_building"))
                .resizable(false)
                .show(ctx, |ui| {
                    if self.image_job.is_some() || self.image_draft.is_some() {
                        ui.label(shell.tr(
                            if self.image_job.is_some() {
                                "buildings.imageLoading"
                            } else {
                                "buildings.imagePlace"
                            },
                            &[],
                        ));
                    }
                    self.show_error(ui, shell);
                    if ui.button(shell.tr("buildings.cancel", &[])).clicked() {
                        self.cancel();
                    }
                });
        }
        if self.tool == Some(Tool::Rectangle) {
            egui::Window::new(shell.tr("buildings.rectangle", &[]))
                .id(egui::Id::new("rectangle_building"))
                .resizable(false)
                .show(ctx, |ui| {
                    ui.checkbox(&mut self.square, shell.tr("buildings.square", &[]));
                    if ui.button(shell.tr("buildings.cancel", &[])).clicked() {
                        self.cancel();
                    }
                    self.show_error(ui, shell);
                });
        }
        if self.tool == Some(Tool::Polygon) {
            egui::Window::new(shell.tr("buildings.polygon", &[]))
                .id(egui::Id::new("polygon_building"))
                .resizable(false)
                .show(ctx, |ui| {
                    ui.label(shell.tr("buildings.polygonHelp", &[]));
                    if ui.button(shell.tr("buildings.finish", &[])).clicked() {
                        edit = self.finish_polygon();
                    }
                    if ui.button(shell.tr("buildings.cancel", &[])).clicked() {
                        self.cancel();
                    }
                    self.show_error(ui, shell);
                });
        }
        let form_mode = self.form.is_some();
        let candidate = self.form.clone().or_else(|| {
            self.selected
                .and_then(|i| document.buildings().get(i))
                .cloned()
        });
        if let Some(mut candidate) = candidate {
            let mut open = true;
            let mut changed = false;
            let title = if form_mode {
                "buildings.new"
            } else {
                "buildings.inspector"
            };
            egui::Window::new(shell.tr(title, &[]))
                .id(egui::Id::new("building_inspector"))
                .open(&mut open)
                .default_width(290.)
                .vscroll(true)
                .show(ctx, |ui| {
                    if form_mode {
                        ui.horizontal(|ui| {
                            if ui
                                .selectable_label(
                                    candidate.vertices.is_none(),
                                    shell.tr("buildings.rectangleShape", &[]),
                                )
                                .clicked()
                            {
                                candidate.vertices = None;
                                changed = true;
                            }
                            if ui
                                .selectable_label(
                                    candidate.vertices.is_some(),
                                    shell.tr("buildings.polygonShape", &[]),
                                )
                                .clicked()
                            {
                                candidate.vertices = Some(candidate.points());
                                changed = true;
                            }
                        });
                    }
                    changed |= fields(ui, &mut candidate, shell);
                    if form_mode && let Some(points) = &mut candidate.vertices {
                        if ui.button(shell.tr("buildings.addVertex", &[])).clicked() {
                            points.push([0., 0.]);
                            changed = true;
                        }
                        if ui.button(shell.tr("buildings.removeVertex", &[])).clicked() {
                            points.pop();
                            changed = true;
                        }
                        candidate.sync_polygon_bounds();
                    }
                    if form_mode {
                        if ui.button(shell.tr("buildings.create", &[])).clicked() {
                            if candidate.label.trim().is_empty() {
                                self.error = Some(BuildingError("name-required"));
                            } else if let Err(error) = candidate.validate() {
                                self.error = Some(error);
                            } else {
                                edit = Some(BuildingEdit::Create(candidate.clone()));
                                self.form = None;
                            }
                        }
                    } else {
                        self.parking_form.inspector(ui, document, shell);
                        if candidate.is_image()
                            && ui
                                .add_enabled(
                                    self.image_job.is_none(),
                                    egui::Button::new(shell.tr("buildings.replaceImage", &[])),
                                )
                                .clicked()
                        {
                            self.upload_image(ctx, shell, self.selected);
                        }
                        if ui.button(shell.tr("buildings.delete", &[])).clicked() {
                            self.request_delete();
                            self.delete_answer = Some(shell.confirm(
                                shell.tr("buildings.delete", &[]),
                                shell.tr("buildings.deleteConfirm", &[("name", &candidate.label)]),
                            ));
                        }
                    }
                    self.show_error(ui, shell);
                });
            if !open {
                self.form = None;
                self.select(None);
            } else if changed {
                if form_mode {
                    self.form = Some(candidate);
                } else if let Err(error) = candidate.validate() {
                    self.error = Some(error);
                } else {
                    self.error = None;
                    edit = Some(BuildingEdit::Update(
                        self.selected.expect("selected building"),
                        candidate,
                    ));
                }
            }
        }
        self.delete_shortcut(ctx, document, shell);
        self.parking_form.show_dialog(ctx, document, shell);
        edit
    }

    fn show_error(&self, ui: &mut egui::Ui, shell: &Shell) {
        if let Some(error) = self.error {
            ui.colored_label(egui::Color32::RED, shell.tr(&error.translation_key(), &[]));
        }
    }

    /// Controls stay above the traffic callback, even where roads overlap buildings.
    pub fn paint_controls(
        &self,
        painter: &egui::Painter,
        document: &MapDocument,
        rect: egui::Rect,
        view: WorldView,
        shift: [f32; 2],
    ) {
        let painter = painter.with_clip_rect(rect);
        self.parking.paint(&painter, rect, view);
        if let Some(building) = self
            .preview
            .as_ref()
            .or_else(|| self.selected.and_then(|i| document.buildings().get(i)))
        {
            let corners = building.corners();
            let points = building.vertices.as_deref().unwrap_or(&corners);
            for (a, b) in points.iter().zip(points.iter().cycle().skip(1)) {
                painter.line_segment(
                    [screen(*a, rect, view, shift), screen(*b, rect, view, shift)],
                    egui::Stroke::new(2_f32, egui::Color32::YELLOW),
                );
            }
            for (handle, point) in handles(building) {
                let color = if handle == Handle::Rotate {
                    egui::Color32::LIGHT_GREEN
                } else {
                    egui::Color32::YELLOW
                };
                painter.circle_filled(screen(point, rect, view, shift), 5., color);
            }
        }
    }

    pub fn paint(
        &mut self,
        ui: &egui::Ui,
        document: &MapDocument,
        rect: egui::Rect,
        view: WorldView,
        shift: [f32; 2],
        mut shape: impl FnMut(usize),
    ) {
        let painter = ui.painter().with_clip_rect(rect);
        self.images.retain(document, self.image_draft.as_ref());
        for (i, saved) in document.buildings().iter().enumerate() {
            let building = if self.selected == Some(i) {
                self.preview.as_ref().unwrap_or(saved)
            } else {
                saved
            };
            if building.is_image() {
                self.images.paint(
                    &painter,
                    building,
                    building.corners().map(|p| screen(p, rect, view, shift)),
                );
            } else {
                shape(i);
            }
        }
        if self.drag.as_ref().is_some_and(|d| d.index.is_none()) && self.preview.is_some() {
            shape(document.buildings().len());
        }
        if let Some(draft) = &self.image_draft
            && let Some(pos) = ui
                .input(|i| i.pointer.hover_pos())
                .filter(|p| rect.contains(*p))
        {
            let center = world(pos, rect, view, shift);
            self.images.paint(
                &painter,
                draft,
                draft.corners().map(|p| {
                    screen(
                        std::array::from_fn(|i| p[i] + center[i] - draft.center[i]),
                        rect,
                        view,
                        shift,
                    )
                }),
            );
        }
        if self.tool == Some(Tool::Polygon) {
            for pair in self.vertices.windows(2) {
                painter.line_segment(
                    [
                        screen(pair[0], rect, view, shift),
                        screen(pair[1], rect, view, shift),
                    ],
                    egui::Stroke::new(2_f32, egui::Color32::YELLOW),
                );
            }
            for p in &self.vertices {
                painter.circle_filled(screen(*p, rect, view, shift), 4., egui::Color32::YELLOW);
            }
            if let (Some(last), Some(pos)) =
                (self.vertices.last(), ui.input(|i| i.pointer.hover_pos()))
            {
                painter.line_segment(
                    [screen(*last, rect, view, shift), pos],
                    egui::Stroke::new(1_f32, egui::Color32::YELLOW),
                );
            }
        }
        if !self.active()
            && ui.rect_contains_pointer(rect)
            && let Some(pos) = ui.input(|i| i.pointer.hover_pos())
            && let Some(building) = document
                .buildings()
                .iter()
                .rev()
                .find(|b| b.contains(world(pos, rect, view, shift)))
        {
            egui::Tooltip::always_open(
                ui.ctx().clone(),
                ui.layer_id(),
                egui::Id::new("building_name"),
                egui::PopupAnchor::Pointer,
            )
            .show(|ui| {
                ui.label(&building.label);
            });
        }
    }
}

fn fields(ui: &mut egui::Ui, building: &mut Building, shell: &Shell) -> bool {
    let mut changed = false;
    ui.label(shell.tr("buildings.name", &[]));
    changed |= ui.text_edit_singleline(&mut building.label).changed();
    let before = building.clone();
    for (index, key) in [(0, "buildings.x"), (1, "buildings.y")] {
        ui.horizontal(|ui| {
            ui.label(shell.tr(key, &[]));
            changed |= ui
                .add(egui::DragValue::new(&mut building.center[index]).speed(1.))
                .changed();
        });
    }
    if before.center != building.center {
        *building = before.moved(std::array::from_fn(|i| {
            building.center[i] - before.center[i]
        }));
        changed = true;
    }
    if building.vertices.is_none() {
        for (index, key) in [(0, "buildings.width"), (1, "buildings.height")] {
            ui.horizontal(|ui| {
                ui.label(shell.tr(key, &[]));
                let before = building.size;
                let resized = ui
                    .add(egui::DragValue::new(&mut building.size[index]).speed(1.))
                    .changed();
                if resized && building.is_image() {
                    building.size[1 - index] =
                        before[1 - index] * building.size[index] / before[index];
                }
                changed |= resized;
            });
        }
    }
    let mut angle = building.angle;
    ui.horizontal(|ui| {
        ui.label(shell.tr("buildings.angle", &[]));
        changed |= ui
            .add(egui::DragValue::new(&mut angle).suffix("°"))
            .changed();
    });
    if angle != building.angle {
        *building = building.rotated(angle);
    }
    if let Some(points) = &mut building.vertices {
        let mut vertices_changed = false;
        ui.label(shell.tr("buildings.vertices", &[]));
        for (index, point) in points.iter_mut().enumerate() {
            ui.horizontal(|ui| {
                ui.label((index + 1).to_string());
                for value in point {
                    vertices_changed |= ui.add(egui::DragValue::new(value).speed(1.)).changed();
                }
            });
        }
        if vertices_changed {
            building.sync_polygon_bounds();
            changed = true;
        }
    }
    if building.is_image() {
        return changed;
    }
    ui.label(shell.tr("buildings.color", &[]));
    ui.horizontal(|ui| {
        let names = ["brown", "gray", "blue", "sky", "green", "legacyBrown"];
        for (index, color) in PALETTE.iter().enumerate() {
            let button = egui::Button::new("  ")
                .fill(parse_color(color))
                .selected(building.palette_index() == Some(index));
            if ui
                .add(button)
                .on_hover_text(shell.tr(&format!("buildings.{}", names[index]), &[]))
                .clicked()
            {
                building.color = (*color).into();
                changed = true;
            }
        }
    });
    changed
}

fn parse_color(text: &str) -> egui::Color32 {
    let text = text.trim_start_matches('#');
    if (text.len() == 6 || text.len() == 8)
        && text.is_ascii()
        && let Ok(n) = u32::from_str_radix(text, 16)
    {
        let (rgb, alpha) = if text.len() == 8 {
            (n >> 8, n as u8)
        } else {
            (n, 255)
        };
        return egui::Color32::from_rgba_unmultiplied(
            (rgb >> 16) as u8,
            (rgb >> 8) as u8,
            rgb as u8,
            alpha,
        );
    }
    egui::Color32::from_rgb(139, 69, 19)
}
