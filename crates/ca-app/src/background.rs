//! Static zone labels. The GPU owns polygon geometry and fills.
use ca_core::{camera::WorldView, map_json::BackgroundZone};
use eframe::egui;

pub struct Background {
    labels: Vec<(String, [f32; 2])>,
}

impl Background {
    pub fn new(zones: &[BackgroundZone], shift: [f32; 2]) -> Self {
        Self {
            labels: zones
                .iter()
                .filter(|z| z.show_label)
                .map(|z| {
                    let center = std::array::from_fn(|i| {
                        z.points.iter().map(|p| p[i]).sum::<f32>() / z.points.len() as f32
                            + shift[i]
                    });
                    (z.label.clone(), center)
                })
                .collect(),
        }
    }

    pub fn paint(&self, painter: &egui::Painter, view: WorldView, rect: egui::Rect) {
        for (label, point) in &self.labels {
            let pos = egui::pos2(
                rect.left() + (point[0] - view.origin[0]) / view.span[0] * rect.width(),
                rect.top() + (point[1] - view.origin[1]) / view.span[1] * rect.height(),
            );
            painter.text(
                pos,
                egui::Align2::CENTER_CENTER,
                label,
                egui::FontId::proportional(14.0),
                egui::Color32::WHITE,
            );
        }
    }
}
