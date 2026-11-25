//! Map input adapter. All picks and drawing use the same local-screen camera.
use ca_core::{
    camera::{Camera, WorldView},
    cell_index::{CellIndex, CellRef, StreetGeometry},
};
use eframe::egui;

pub struct MapFrame {
    pub rect: egui::Rect,
    pub view: WorldView,
    pub clicked: Option<CellRef>,
    pub tooltip: Option<String>,
    pub preview: Option<CellPreview>,
    pub vertex_edit: Option<crate::vertices::VertexEdit>,
    pub vertex_mode: bool,
    pub structural_edit: bool,
    pub street_preview: Option<ca_core::streets::StreetDraft>,
    pub street_edit: Option<ca_core::streets::StreetEdit>,
}

#[derive(Clone, Copy, Debug)]
pub struct CellPreview {
    pub cell: CellRef,
    pub rect: egui::Rect,
    pub corners: [egui::Pos2; 4],
}

impl MapFrame {
    /// Draw after the GPU callback so the target stays visible over the map.
    pub fn paint_preview(&self, painter: &egui::Painter) {
        if let Some(draft) = self.street_preview {
            let corners = draft.corners().map(|p| {
                self.rect.min
                    + egui::vec2(
                        (p[0] - self.view.origin[0]) * self.rect.width() / self.view.span[0],
                        (p[1] - self.view.origin[1]) * self.rect.height() / self.view.span[1],
                    )
            });
            painter.add(egui::Shape::convex_polygon(
                corners.to_vec(),
                egui::Color32::from_white_alpha(50),
                egui::Stroke::new(1.5_f32, egui::Color32::YELLOW),
            ));
            painter.text(
                corners[0],
                egui::Align2::LEFT_BOTTOM,
                draft.cells.to_string(),
                egui::FontId::proportional(16.0),
                egui::Color32::WHITE,
            );
        }
        if let Some(preview) = self.preview {
            for i in 0..4 {
                painter.line_segment(
                    [preview.corners[i], preview.corners[(i + 1) % 4]],
                    egui::Stroke::new(1.5_f32, egui::Color32::WHITE),
                );
            }
        }
    }
}

pub struct MapInteraction {
    extent: [f32; 2],
    bounds: ([f32; 2], [f32; 2]),
    camera: Option<Camera>,
    index: CellIndex,
    names: Vec<String>,
    touch_gesture: bool,
    vertices: crate::vertices::VertexEditor,
    drawing: bool,
    draw_start: Option<[f64; 2]>,
    drawing_gesture: bool,
    selected: Option<usize>,
    sorted: Vec<usize>,
    street_sizes: Vec<Vec<usize>>,
}

impl MapInteraction {
    pub fn new(extent: [f32; 2], streets: &[StreetGeometry], names: Vec<String>) -> Self {
        let mut index = CellIndex::new(1.0);
        index.sync(streets);
        let sorted = (0..names.len()).collect();
        Self {
            extent,
            bounds: ([0.0; 2], extent),
            camera: None,
            index,
            names,
            touch_gesture: false,
            vertices: Default::default(),
            drawing: false,
            draw_start: None,
            drawing_gesture: false,
            selected: None,
            sorted,
            street_sizes: streets
                .iter()
                .map(|s| s.centers.iter().map(Vec::len).collect())
                .collect(),
        }
    }

    pub fn camera(&self) -> Option<&Camera> {
        self.camera.as_ref()
    }

    pub fn set_drawing(&mut self, drawing: bool) {
        self.drawing = drawing;
        self.draw_start = None;
    }

    pub fn drawing(&self) -> bool {
        self.drawing
    }
    pub fn selected(&self) -> Option<usize> {
        self.selected
    }
    pub fn select(&mut self, street: Option<usize>) {
        self.selected = street;
    }

    pub fn show_tools(&mut self, ui: &mut egui::Ui, shell: &crate::shell::Shell) {
        let mut drawing = self.drawing;
        if ui
            .selectable_label(drawing, shell.tr("streetDrawing.button", &[]))
            .clicked()
        {
            drawing = !drawing;
            self.set_drawing(drawing);
        }
    }

    pub fn finish_edits(&mut self) {
        self.set_drawing(false);
        self.drawing_gesture = false;
        self.vertices.finish();
    }

    pub fn show_selector(&mut self, ui: &mut egui::Ui, shell: &crate::shell::Shell) {
        egui::ComboBox::from_id_salt("street-selector")
            .selected_text(
                self.selected
                    .and_then(|id| self.names.get(id))
                    .cloned()
                    .unwrap_or_else(|| shell.tr("streetDrawing.select", &[])),
            )
            .show_ui(ui, |ui| {
                for &id in &self.sorted {
                    ui.selectable_value(&mut self.selected, Some(id), &self.names[id]);
                }
            });
    }

    pub fn paint_selection(&self, painter: &egui::Painter, rect: egui::Rect) {
        let (Some(street), Some(camera)) = (self.selected, &self.camera) else {
            return;
        };
        let Some(lanes) = self.street_sizes.get(street) else {
            return;
        };
        for (lane, &length) in lanes.iter().enumerate() {
            for index in 0..length {
                if let Some(corners) = self.index.cell_corners(CellRef {
                    street,
                    lane,
                    index,
                }) {
                    let p = corners.map(|p| {
                        let p = camera.world_to_screen(p);
                        rect.min + egui::vec2(p[0], p[1])
                    });
                    for (edge, visible) in [
                        (0, lane == 0),
                        (1, index + 1 == length),
                        (2, lane + 1 == lanes.len()),
                        (3, index == 0),
                    ] {
                        if visible {
                            painter.line_segment(
                                [p[edge], p[(edge + 1) % 4]],
                                egui::Stroke::new(2.0_f32, egui::Color32::YELLOW),
                            );
                        }
                    }
                }
            }
        }
    }

    pub fn configure(
        &mut self,
        document: &ca_core::map_json::MapDocument,
        shift: [f32; 2],
    ) -> ca_core::map_json::MapGeometry {
        let mut geometry = document.geometry_snapshot();
        geometry.translate(shift);
        self.names = document.layout().iter().map(|p| p.name.clone()).collect();
        self.sorted = crate::streets::sorted_streets(document);
        self.street_sizes = geometry
            .streets
            .iter()
            .map(|s| s.centers.iter().map(Vec::len).collect())
            .collect();
        self.index.sync_oriented(&geometry.streets, &geometry.axes);
        let mut minimum = [0.0_f32; 2];
        let mut maximum = self.extent;
        for street in &geometry.streets {
            for (lane, centers) in street.centers.iter().enumerate() {
                for (index, center) in centers.iter().enumerate() {
                    let axis = geometry.axes[street.id][lane][index];
                    let radius = (axis[0].abs() + axis[1].abs()) * 0.5;
                    for i in 0..2 {
                        minimum[i] = minimum[i].min(center[i] - radius);
                        maximum[i] = maximum[i].max(center[i] + radius);
                    }
                }
            }
        }
        self.bounds = (minimum, maximum);
        if let Some(camera) = &mut self.camera {
            camera.set_bounds(minimum, maximum);
        }
        self.vertices.sync(document, &geometry.streets);
        geometry
    }

    pub fn paint_vertices(&self, painter: &egui::Painter, rect: egui::Rect) {
        if let Some(camera) = &self.camera {
            self.vertices.paint(painter, rect, camera);
        }
    }

    /// Geometry owners use this only on edits, not on simulation ticks.
    pub fn sync_geometry(&mut self, streets: &[StreetGeometry], names: Vec<String>) {
        self.index.sync(streets);
        self.names = names;
    }

    pub fn show(&mut self, ui: &mut egui::Ui, detect: bool) -> MapFrame {
        let rect = ui.available_rect_before_wrap();
        let response = ui.allocate_rect(rect, egui::Sense::click_and_drag());
        let viewport = [rect.width().max(1.0), rect.height().max(1.0)];
        let camera = self
            .camera
            .get_or_insert_with(|| Camera::fit(self.extent, viewport));
        camera.set_bounds(self.bounds.0, self.bounds.1);
        camera.resize(viewport);
        let street_hit = ui
            .input(|i| i.pointer.interact_pos())
            .filter(|p| rect.contains(*p))
            .and_then(|p| {
                self.index
                    .hit_test(camera.screen_to_world((p - rect.min).into()))
            })
            .map(|c| c.street);
        let vertex_edit =
            self.vertices
                .input(ui, rect, camera, street_hit, response.contains_pointer());
        let pointer = ui.input(|i| i.pointer.clone());
        let mut street_edit = None;
        let mut street_preview = None;
        let was_drawing = self.drawing_gesture;
        if self.vertices.active()
            || ui.input(|i| i.key_pressed(egui::Key::Escape) || i.multi_touch().is_some())
        {
            self.drawing = false;
            self.draw_start = None;
        }
        if self.drawing && !self.vertices.active() {
            if response.contains_pointer()
                && pointer.primary_pressed()
                && street_hit.is_none()
                && let Some(pos) = pointer.interact_pos().filter(|p| rect.contains(*p))
            {
                self.draw_start = Some(
                    camera
                        .screen_to_world((pos - rect.min).into())
                        .map(f64::from),
                );
                self.drawing_gesture = true;
            }
            if let Some(start) = self.draw_start
                && let Some(pos) = pointer.interact_pos()
            {
                street_preview = ca_core::streets::StreetDraft::between(
                    start,
                    camera
                        .screen_to_world((pos - rect.min).into())
                        .map(f64::from),
                );
                if pointer.primary_released() {
                    if rect.contains(pos) {
                        street_edit = street_preview.map(ca_core::streets::StreetEdit::Draw);
                    }
                    self.draw_start = None;
                    street_preview = None;
                    if street_edit.is_some() {
                        self.drawing = false;
                    }
                }
            }
        }
        if !self.vertices.active()
            && !ui.ctx().wants_keyboard_input()
            && ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Delete))
        {
            street_edit = self.selected.map(ca_core::streets::StreetEdit::Delete);
        }
        let blocks_pan = self.vertices.blocks_pan() || self.draw_start.is_some() || was_drawing;
        // Response::drag_delta reads the context; do not call it under input's lock.
        let drag_delta = response.drag_delta();
        ui.input(|input| {
            if let Some(touch) = input.multi_touch() {
                if !blocks_pan
                    && rect.contains(touch.start_pos)
                    && (response.contains_pointer() || response.dragged())
                {
                    self.touch_gesture = true;
                    let anchor = touch.center_pos - touch.translation_delta - rect.min;
                    camera.zoom_at(anchor.into(), touch.zoom_delta);
                    camera.pan(touch.translation_delta.into());
                }
            } else if response.dragged() && !self.touch_gesture && !blocks_pan {
                camera.pan(drag_delta.into());
            }
            if response.hovered()
                && !blocks_pan
                && let Some(pos) = input.pointer.hover_pos()
            {
                let anchor = (pos - rect.min).into();
                for event in &input.events {
                    match event {
                        egui::Event::MouseWheel {
                            unit,
                            delta,
                            modifiers,
                        } => {
                            match unit {
                                // Discrete mouse wheels zoom; pixel trackpads pan.
                                egui::MouseWheelUnit::Line => {
                                    camera.zoom_at(anchor, (delta.y * 0.15).exp())
                                }
                                _ if modifiers.ctrl || modifiers.command => {
                                    camera.zoom_at(anchor, (delta.y * 0.01).exp())
                                }
                                egui::MouseWheelUnit::Point => camera.pan(delta.into()),
                                egui::MouseWheelUnit::Page => {
                                    camera.pan([delta.x * viewport[0], delta.y * viewport[1]])
                                }
                            }
                        }
                        egui::Event::Zoom(factor) if input.multi_touch().is_none() => {
                            camera.zoom_at(anchor, *factor)
                        }
                        _ => {}
                    }
                }
            }
        });
        let hit = response
            .hover_pos()
            .filter(|_| !response.dragged() && !self.touch_gesture)
            .and_then(|pos| {
                self.index
                    .hit_test(camera.screen_to_world((pos - rect.min).into()))
            });
        if response.clicked() && !self.vertices.active() && !was_drawing {
            self.selected = hit.map(|c| c.street);
        }
        let clicked =
            (response.clicked() && !self.vertices.active() && !was_drawing && !self.drawing)
                .then_some(hit)
                .flatten();
        let preview = hit.and_then(|cell| {
            let corners = self.index.cell_corners(cell)?.map(|p| {
                let p = camera.world_to_screen(p);
                rect.min + egui::vec2(p[0], p[1])
            });
            Some(CellPreview {
                cell,
                rect: egui::Rect::from_points(&corners),
                corners,
            })
        });
        if preview.is_some() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Crosshair);
        }
        let tooltip = hit.filter(|_| detect).and_then(|cell| {
            self.names
                .get(cell.street)
                .map(|name| format!("{name} : {}", cell.index))
        });
        if let Some(text) = &tooltip {
            response.on_hover_text_at_pointer(text);
        }
        if !ui.input(|i| i.pointer.any_down()) {
            self.touch_gesture = false;
            self.drawing_gesture = false;
        }
        MapFrame {
            rect,
            view: camera.view(),
            clicked,
            tooltip,
            preview,
            vertex_edit,
            vertex_mode: self.vertices.active(),
            structural_edit: self.vertices.active() || self.draw_start.is_some(),
            street_preview,
            street_edit,
        }
    }
}
