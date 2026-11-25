//! Cached display-only street geometry. Saved cells and links stay unchanged.
use ca_core::{camera::Camera, geometry::CellGeometry, streets::StreetError};
use eframe::egui;

pub struct GeometryPreview {
    pub street: usize,
    pub geometry: CellGeometry,
    pub error: Option<StreetError>,
    drawing: egui::Shape,
    view: (egui::Rect, ca_core::camera::WorldView, f32),
}

impl GeometryPreview {
    pub(crate) fn new(
        street: usize,
        geometry: CellGeometry,
        error: Option<StreetError>,
        ui: &egui::Ui,
        rect: egui::Rect,
        camera: &Camera,
    ) -> Self {
        let screen = |p| {
            let p = camera.world_to_screen(p);
            rect.min + egui::vec2(p[0], p[1])
        };
        let color = if error.is_some() {
            egui::Color32::RED
        } else {
            egui::Color32::YELLOW
        };
        let mut shapes = Vec::new();
        for (centers, axes) in geometry.centers.iter().zip(&geometry.axes) {
            for (&center, &axis) in centers.iter().zip(axes) {
                let corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(|[x, y]| {
                    screen([
                        center[0] + axis[0] * x - axis[1] * y,
                        center[1] + axis[1] * x + axis[0] * y,
                    ])
                });
                shapes.push(egui::epaint::ClippedShape {
                    clip_rect: rect,
                    shape: egui::Shape::convex_polygon(
                        corners.to_vec(),
                        egui::Color32::from_rgb(22, 26, 33),
                        egui::Stroke::new(1.0_f32, color),
                    ),
                });
            }
        }
        let mut mesh = egui::Mesh::default();
        for primitive in ui.ctx().tessellate(shapes, ui.ctx().pixels_per_point()) {
            if let egui::epaint::Primitive::Mesh(part) = primitive.primitive {
                mesh.append(part);
            }
        }
        Self {
            street,
            geometry,
            error,
            drawing: egui::Shape::mesh(mesh),
            view: (rect, camera.view(), ui.ctx().pixels_per_point()),
        }
    }

    pub(crate) fn matches_view(&self, ui: &egui::Ui, rect: egui::Rect, camera: &Camera) -> bool {
        self.view == (rect, camera.view(), ui.ctx().pixels_per_point())
    }

    pub(crate) fn paint(&self, painter: &egui::Painter) {
        // Cloning a mesh shape clones an Arc, not its vertex/index buffers.
        painter.add(self.drawing.clone());
    }
}
