//! Session-only arrow display. Uses the same world view as the traffic shader.
use ca_core::camera::WorldView;
use eframe::egui;

use crate::shell::Shell;

pub struct ConnectionOverlays {
    arrows: Vec<[[f32; 2]; 2]>,
    visible: bool,
}

impl ConnectionOverlays {
    pub fn new(arrows: Vec<[[f32; 2]; 2]>) -> Self {
        Self {
            arrows,
            visible: true,
        }
    }

    pub fn show_toggle(&mut self, ui: &mut egui::Ui, shell: &Shell) -> egui::Response {
        ui.checkbox(&mut self.visible, shell.tr("connections.showArrows", &[]))
    }

    pub fn screen_arrows(
        &self,
        view: WorldView,
        rect: egui::Rect,
    ) -> impl Iterator<Item = (egui::Pos2, egui::Pos2)> + '_ {
        let point = move |world: [f32; 2]| {
            egui::pos2(
                rect.left() + (world[0] - view.origin[0]) / view.span[0] * rect.width(),
                rect.top() + (world[1] - view.origin[1]) / view.span[1] * rect.height(),
            )
        };
        self.arrows
            .iter()
            .filter(|_| self.visible)
            .map(move |arrow| (point(arrow[0]), point(arrow[1])))
    }

    /// Called after the GPU map callback; clip arrows to the map panel.
    pub fn paint(&self, painter: &egui::Painter, view: WorldView, rect: egui::Rect) {
        let painter = painter.with_clip_rect(rect);
        for (source, destination) in self.screen_arrows(view, rect) {
            painter.arrow(
                source,
                destination - source,
                egui::Stroke::new(1.5_f32, egui::Color32::from_rgb(107, 255, 139)),
            );
        }
    }
}
