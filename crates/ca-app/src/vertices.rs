//! Screen-space legacy curve handles. Drag state is separate from map geometry.
use ca_core::{camera::Camera, map_json::MapDocument, traffic::CalleType};
use eframe::egui;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VertexEdit {
    pub street: usize,
    pub vertex: usize,
    pub offset: f64,
}

struct Handle {
    edit: VertexEdit,
    point: [f32; 2],
    angle: f64,
}

#[derive(Default)]
pub struct VertexEditor {
    active: bool,
    selected: Option<usize>,
    handles: Vec<Handle>,
    drag: Option<(usize, egui::Pos2, VertexEdit, f64)>,
}

impl VertexEditor {
    pub fn active(&self) -> bool {
        self.active
    }

    pub fn sync(
        &mut self,
        document: &MapDocument,
        geometry: &[ca_core::cell_index::StreetGeometry],
    ) {
        self.handles.clear();
        for (street, (p, s)) in document
            .layout()
            .iter()
            .zip(document.model().streets())
            .enumerate()
        {
            if s.config().tipo != CalleType::Conexion {
                continue;
            }
            let centers = &geometry[street].centers;
            for (vertex, v) in p.vertices.iter().enumerate() {
                // Old v1 files can retain handles beyond a resized road.
                if let Some(point) = centers[s.config().carriles / 2].get(v.index) {
                    self.handles.push(Handle {
                        edit: VertexEdit {
                            street,
                            vertex,
                            offset: v.offset,
                        },
                        point: *point,
                        angle: p.angle_degrees,
                    });
                }
            }
        }
    }

    pub fn input(
        &mut self,
        ui: &egui::Ui,
        rect: egui::Rect,
        camera: &Camera,
        hit: Option<usize>,
        owns_pointer: bool,
    ) -> Option<VertexEdit> {
        let toggle = ui.input(|i| {
            i.events.iter().any(|event| {
                matches!(event,
            egui::Event::Key { key:egui::Key::Z,pressed:true,repeat:false,modifiers,.. }
                if modifiers.is_none())
            })
        });
        if toggle
            && !ui.ctx().wants_keyboard_input()
            && ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Z))
        {
            self.active = !self.active;
            self.drag = None;
        }
        if !self.active {
            return None;
        }
        let pointer = ui.input(|i| i.pointer.clone());
        if owns_pointer
            && pointer.primary_pressed()
            && let Some(pos) = pointer.interact_pos().filter(|p| rect.contains(*p))
        {
            let candidate = self
                .handles
                .iter()
                .enumerate()
                .filter(|(_, h)| Some(h.edit.street) == self.selected)
                .map(|(i, h)| {
                    let p = camera.world_to_screen(h.point);
                    (i, pos.distance(rect.min + egui::vec2(p[0], p[1])))
                })
                .filter(|(_, distance)| *distance <= 12.0)
                .min_by(|a, b| a.1.total_cmp(&b.1));
            if let Some((i, _)) = candidate {
                self.drag = Some((i, pos, self.handles[i].edit, self.handles[i].angle));
            } else {
                self.selected = hit;
            }
        }
        let edit = self.drag.and_then(|(_, start, original, angle)| {
            let pos = pointer.interact_pos()?;
            if pointer.delta() == egui::Vec2::ZERO {
                return None;
            }
            let rad = -angle.to_radians();
            let delta = pos - start;
            // Screen displacement gives the same sensitivity at every zoom.
            let lateral = delta.x as f64 * -rad.sin() + delta.y as f64 * rad.cos();
            Some(VertexEdit {
                offset: (original.offset - lateral * 0.45).clamp(-90.0, 90.0),
                ..original
            })
        });
        if !pointer.primary_down() {
            self.drag = None;
        }
        edit
    }

    pub fn blocks_pan(&self) -> bool {
        self.active
    }

    pub fn paint(&self, painter: &egui::Painter, rect: egui::Rect, camera: &Camera) {
        if !self.active {
            return;
        }
        for handle in self
            .handles
            .iter()
            .filter(|h| Some(h.edit.street) == self.selected)
        {
            let point = camera.world_to_screen(handle.point);
            painter.circle_filled(
                rect.min + egui::vec2(point[0], point[1]),
                5.0,
                egui::Color32::YELLOW,
            );
        }
    }
}
