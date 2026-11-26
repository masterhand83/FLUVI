//! Live metric presentation and lossless, bounded delivery from simulation history.
use ca_core::{
    camera::WorldView,
    map_json::MapDocument,
    metrics::{LIVE_POINTS, Metrics, Point},
};
use crossbeam_channel::Sender;
use eframe::egui;

use crate::shell::{Shell, Translator};
mod chart;

#[derive(Clone, Copy, Debug)]
pub enum Packet {
    Reset,
    Point(Point),
}

#[derive(Default)]
pub struct Delivery {
    cursor: usize,
    reset_pending: bool,
}

impl Delivery {
    pub fn reset(&mut self) {
        self.cursor = 0;
        self.reset_pending = true;
    }

    /// Retry unsent history next frame. A slow or closed UI never blocks ticks.
    pub fn publish(&mut self, metrics: &Metrics, output: &Sender<Packet>) {
        if self.reset_pending {
            if output.try_send(Packet::Reset).is_err() {
                return;
            }
            self.reset_pending = false;
        }
        for point in &metrics.history()[self.cursor..] {
            if output.try_send(Packet::Point(*point)).is_err() {
                break;
            }
            self.cursor += 1;
        }
    }
}

#[derive(Clone, Copy)]
pub enum Metric {
    Density,
    NetChange,
    Speed,
    Throughput,
    Entropy,
}

impl Metric {
    pub const ALL: [Self; 5] = [
        Self::Density,
        Self::NetChange,
        Self::Speed,
        Self::Throughput,
        Self::Entropy,
    ];

    pub fn key(self) -> &'static str {
        match self {
            Self::Density => "metrics.density",
            Self::NetChange => "metrics.netChange",
            Self::Speed => "metrics.speed",
            Self::Throughput => "metrics.throughput",
            Self::Entropy => "metrics.entropy",
        }
    }

    fn value(self, point: Point) -> f64 {
        match self {
            Self::Density => point.density,
            Self::NetChange => point.net_change,
            Self::Speed => point.speed,
            Self::Throughput => point.throughput,
            Self::Entropy => point.entropy,
        }
    }

    fn formatted(self, point: Point) -> String {
        let unit = match self {
            Self::Density | Self::Speed => "%",
            Self::NetChange | Self::Throughput => " veh/s",
            Self::Entropy => " bits",
        };
        let precision = if matches!(self, Self::Entropy) { 3 } else { 2 };
        format!("{:.*}{unit}", precision, self.value(point))
    }

    pub fn tooltip(self, point: Point, translator: &Translator) -> [String; 4] {
        [
            translator.tr(self.key(), &[]),
            format!(
                "{} {}",
                translator.tr(point.clock.day_key(), &[]),
                point.clock.numeric()
            ),
            self.formatted(point),
            translator.tr(point.status().key(), &[]),
        ]
    }
}

pub enum Action {
    Heatmap,
    Checklist,
    Map,
}

#[derive(Default)]
pub struct MetricsPanel {
    history: Vec<Point>,
    included: Vec<bool>,
    order: Vec<usize>,
    draft: Option<Vec<bool>>,
    pub picking: bool,
    overlays: Vec<Vec<Vec<[f32; 2]>>>,
}

impl MetricsPanel {
    pub fn receive(&mut self, packet: Packet) {
        match packet {
            Packet::Reset => self.history.clear(),
            Packet::Point(point) => self.history.push(point),
        }
    }

    pub fn history(&self) -> &[Point] {
        &self.history
    }
    pub fn live(&self) -> &[Point] {
        &self.history[self.history.len().saturating_sub(LIVE_POINTS)..]
    }
    pub fn included(&self) -> &[bool] {
        &self.included
    }
    pub fn accept_selection(&mut self, included: Vec<bool>) {
        self.included = included;
        self.draft = None;
    }

    /// Called only at map installation or geometry changes.
    pub fn configure(&mut self, document: &MapDocument, deleted: Option<usize>) {
        if let Some(id) = deleted {
            self.included.remove(id);
        }
        self.included.resize(document.layout().len(), true);
        self.order = crate::streets::sorted_streets(document);
        self.overlays = document
            .geometry_snapshot()
            .streets
            .into_iter()
            .map(|s| s.centers)
            .collect();
        self.draft = None;
    }

    pub fn rows(&self) -> &[usize] {
        &self.order
    }

    pub fn open_checklist(&mut self) {
        self.picking = false;
        self.draft = Some(self.included.clone());
    }

    pub fn show(&mut self, ui: &mut egui::Ui, shell: &Shell) -> Option<Action> {
        let mut action = None;
        if ui.button(shell.tr("heatmap.title", &[])).clicked() {
            action = Some(Action::Heatmap);
        }
        if ui.button(shell.tr("metrics.selectRoads", &[])).clicked() {
            action = Some(Action::Checklist);
        }
        if ui
            .selectable_label(self.picking, shell.tr("metrics.pickMap", &[]))
            .clicked()
        {
            action = Some(Action::Map);
        }
        if self.picking {
            ui.label(shell.tr("metrics.pickHint", &[]));
        }
        if let Some(&point) = self.history.last() {
            ui.strong(shell.tr(point.status().key(), &[]));
            ui.label(shell.tr(point.status().observation_key(), &[]));
        } else {
            ui.label(shell.tr("metrics.noData", &[]));
        }
        for metric in Metric::ALL {
            chart::show(ui, self.live(), metric, shell);
        }
        action
    }

    pub fn dialog(
        &mut self,
        ctx: &egui::Context,
        document: &MapDocument,
        shell: &Shell,
    ) -> Option<Vec<bool>> {
        let draft = self.draft.as_mut()?;
        let order = &self.order;
        let mut open = true;
        let mut apply = false;
        let mut cancel = ctx.input(|i| i.key_pressed(egui::Key::Escape));
        egui::Window::new(shell.tr("metrics.selectRoads", &[]))
            .id(egui::Id::new("metric-streets"))
            .open(&mut open)
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    if ui.button(shell.tr("metrics.all", &[])).clicked() {
                        draft.fill(true);
                    }
                    if ui.button(shell.tr("metrics.none", &[])).clicked() {
                        draft.fill(false);
                    }
                });
                egui::ScrollArea::vertical()
                    .max_height(350.)
                    .show(ui, |ui| {
                        for &id in order {
                            ui.push_id(id, |ui| {
                                ui.checkbox(&mut draft[id], &document.layout()[id].name);
                            });
                        }
                    });
                ui.horizontal(|ui| {
                    apply = ui.button(shell.tr("metrics.apply", &[])).clicked();
                    cancel |= ui.button(shell.tr("metrics.cancel", &[])).clicked();
                });
            });
        if !open || cancel {
            self.draft = None;
            return None;
        }
        apply.then(|| draft.clone())
    }

    pub fn paint(
        &self,
        painter: &egui::Painter,
        view: WorldView,
        rect: egui::Rect,
        shift: [f32; 2],
    ) {
        if !self.picking {
            return;
        }
        let painter = painter.with_clip_rect(rect);
        for (id, lanes) in self.overlays.iter().enumerate() {
            let color = if self.included[id] {
                egui::Color32::LIGHT_GREEN
            } else {
                egui::Color32::LIGHT_RED
            };
            for lane in lanes {
                let points: Vec<_> = lane
                    .iter()
                    .map(|p| {
                        egui::pos2(
                            rect.left()
                                + (p[0] + shift[0] - view.origin[0]) / view.span[0] * rect.width(),
                            rect.top()
                                + (p[1] + shift[1] - view.origin[1]) / view.span[1] * rect.height(),
                        )
                    })
                    .collect();
                let stroke = egui::Stroke::new(4_f32, color);
                if points.len() == 1 {
                    painter.circle_stroke(points[0], 4., stroke);
                } else if self.included[id] {
                    painter.add(egui::Shape::line(points, stroke));
                } else {
                    // Broken red lines distinguish exclusion without color alone.
                    for segment in points.windows(2) {
                        let middle = segment[0].lerp(segment[1], 0.5);
                        painter.line_segment([segment[0], middle], stroke);
                    }
                }
            }
        }
    }
}
