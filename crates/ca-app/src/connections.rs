//! Session-only arrow display. Uses the same world view as the traffic shader.
use ca_core::camera::WorldView;
use ca_core::connections::{ConnectionArrow, ConnectionKind};
use eframe::egui;

use crate::shell::Shell;

pub struct ConnectionOverlays {
    arrows: Vec<ConnectionArrow>,
    visible: bool,
}

impl ConnectionOverlays {
    pub fn new(arrows: Vec<ConnectionArrow>) -> Self {
        Self {
            arrows,
            visible: true,
        }
    }

    /// Map replacement changes topology, not the session display preference.
    pub fn set_arrows(&mut self, arrows: Vec<ConnectionArrow>) {
        self.arrows = arrows;
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
            .map(move |arrow| (point(arrow.endpoints[0]), point(arrow.endpoints[1])))
    }

    /// Called after the GPU map callback; clip arrows to the map panel.
    pub fn paint(&self, painter: &egui::Painter, view: WorldView, rect: egui::Rect) {
        let painter = painter.with_clip_rect(rect);
        for (arrow, (source, destination)) in self.arrows.iter().zip(self.screen_arrows(view, rect))
        {
            painter.arrow(
                source,
                destination - source,
                egui::Stroke::new(1.5_f32, connection_color(arrow.kind)),
            );
        }
    }
}

pub fn connection_color(kind: ConnectionKind) -> egui::Color32 {
    match kind {
        ConnectionKind::Linear => egui::Color32::from_rgb(34, 197, 94),
        ConnectionKind::Incorporation => egui::Color32::from_rgb(249, 115, 22),
        ConnectionKind::Probabilistic => egui::Color32::from_rgb(168, 85, 247),
    }
}
