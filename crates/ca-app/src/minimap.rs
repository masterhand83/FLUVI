//! Retained street overview with a draggable main-camera viewport.
use crate::map::MapInteraction;
use ca_core::{camera::WorldView, map_json::MapDocument};
use eframe::egui;

pub struct Minimap {
    minimum: [f32; 2],
    maximum: [f32; 2],
    revision: Option<(u64, [f32; 2])>,
    paths: Vec<Vec<[f32; 2]>>,
    grab: Option<[f32; 2]>,
}

impl Default for Minimap {
    fn default() -> Self {
        Self::new([0.; 2], [1.; 2])
    }
}

impl Minimap {
    pub fn captures(&self, ctx: &egui::Context, rect: egui::Rect) -> bool {
        self.grab.is_some()
            || ctx.input(|i| i.pointer.interact_pos().is_some_and(|p| rect.contains(p)))
    }
    pub fn new(minimum: [f32; 2], maximum: [f32; 2]) -> Self {
        Self {
            minimum,
            maximum,
            revision: None,
            paths: vec![],
            grab: None,
        }
    }

    pub fn invalidate_geometry(&mut self) {
        self.revision = None;
        self.grab = None;
    }

    pub fn sync(&mut self, document: &MapDocument, revision: u64, shift: [f32; 2]) {
        if self.revision == Some((revision, shift)) {
            return;
        }
        self.paths.clear();
        self.minimum = [f32::INFINITY; 2];
        self.maximum = [f32::NEG_INFINITY; 2];
        for (road, model) in document.layout().iter().zip(document.model().streets()) {
            let geometry = road.cells(model.config().carriles, model.config().tamano);
            for lane in geometry.centers {
                let mut path = Vec::with_capacity(lane.len() + 1);
                for point in lane {
                    let point = std::array::from_fn(|i| point[i] + shift[i]);
                    for (i, value) in point.into_iter().enumerate() {
                        self.minimum[i] = self.minimum[i].min(value - 0.75);
                        self.maximum[i] = self.maximum[i].max(value + 0.75);
                    }
                    path.push(point);
                }
                if road.roundabout.is_some() {
                    path.push(path[0]);
                }
                self.paths.push(path);
            }
        }
        if self.paths.is_empty() {
            self.minimum = [0.; 2];
            self.maximum = [1.; 2];
        }
        self.revision = Some((revision, shift));
    }

    /// Fit the overview without distorting world distances.
    fn fitted_view(&self, rect: egui::Rect) -> WorldView {
        let extent: [f32; 2] = std::array::from_fn(|i| self.maximum[i] - self.minimum[i]);
        let scale = (rect.width() / extent[0]).min(rect.height() / extent[1]);
        let span = [rect.width() / scale, rect.height() / scale];
        WorldView {
            origin: std::array::from_fn(|i| self.minimum[i] + (extent[i] - span[i]) / 2.),
            span,
        }
    }

    pub fn world_at(&self, rect: egui::Rect, point: egui::Pos2) -> [f32; 2] {
        let view = self.fitted_view(rect);
        [
            view.origin[0] + (point.x - rect.left()) / rect.width() * view.span[0],
            view.origin[1] + (point.y - rect.top()) / rect.height() * view.span[1],
        ]
    }

    fn screen_at(&self, rect: egui::Rect, world: [f32; 2]) -> egui::Pos2 {
        let view = self.fitted_view(rect);
        rect.min
            + egui::vec2(
                (world[0] - view.origin[0]) / view.span[0] * rect.width(),
                (world[1] - view.origin[1]) / view.span[1] * rect.height(),
            )
    }

    pub fn viewport(&self, rect: egui::Rect, view: WorldView) -> egui::Rect {
        egui::Rect::from_min_max(
            self.screen_at(rect, view.origin),
            self.screen_at(rect, std::array::from_fn(|i| view.origin[i] + view.span[i])),
        )
    }

    /// Offset retains the point where the user grabbed the viewport rectangle.
    pub fn move_camera(
        &self,
        map: &mut MapInteraction,
        rect: egui::Rect,
        point: egui::Pos2,
        offset: [f32; 2],
    ) {
        let world = self.world_at(rect, point);
        map.center_on(std::array::from_fn(|i| world[i] - offset[i]));
    }

    /// A separate layer owns input, so minimap drags cannot reach map tools.
    pub fn show(&mut self, ui: &mut egui::Ui, rect: egui::Rect, map: &mut MapInteraction) {
        egui::Area::new(egui::Id::new("minimap"))
            .order(egui::Order::Foreground)
            .fixed_pos(rect.min)
            .movable(false)
            .constrain(false)
            .show(ui.ctx(), |ui| {
                let (_, response) =
                    ui.allocate_exact_size(rect.size(), egui::Sense::click_and_drag());
                let rect = response.rect;
                let Some(camera) = map.camera() else {
                    return;
                };
                let view = camera.view();
                let pointer = ui.input(|i| i.pointer.clone());
                if response.contains_pointer()
                    && pointer.primary_pressed()
                    && let Some(pos) = pointer.interact_pos()
                {
                    let world = self.world_at(rect, pos);
                    let inside = self.viewport(rect, view).contains(pos);
                    self.grab = Some(std::array::from_fn(|i| {
                        if inside {
                            world[i] - view.origin[i] - view.span[i] / 2.
                        } else {
                            0.
                        }
                    }));
                }
                if !ui.input(|i| i.focused) || ui.input(|i| i.key_pressed(egui::Key::Escape)) {
                    self.grab = None;
                }
                if let (Some(offset), Some(pos)) = (self.grab, pointer.interact_pos()) {
                    self.move_camera(map, rect, pos, offset);
                }
                if !pointer.primary_down() {
                    self.grab = None;
                }
                let painter = ui.painter().with_clip_rect(rect);
                painter.rect_filled(rect, 4., egui::Color32::from_rgb(25, 30, 36));
                let scale = rect.width() / self.fitted_view(rect).span[0];
                for path in &self.paths {
                    let points: Vec<_> = path.iter().map(|&p| self.screen_at(rect, p)).collect();
                    if points.len() == 1 {
                        painter.circle_filled(
                            points[0],
                            scale.max(1.) / 2.,
                            egui::Color32::LIGHT_GRAY,
                        );
                    } else {
                        painter.add(egui::Shape::line(
                            points,
                            egui::Stroke::new(scale.max(1.), egui::Color32::LIGHT_GRAY),
                        ));
                    }
                }
                painter.rect_stroke(
                    self.viewport(rect, map.camera().expect("camera").view()),
                    0.,
                    egui::Stroke::new(1.5_f32, egui::Color32::YELLOW),
                    egui::StrokeKind::Inside,
                );
                painter.rect_stroke(
                    rect,
                    4.,
                    egui::Stroke::new(1_f32, egui::Color32::GRAY),
                    egui::StrokeKind::Inside,
                );
            });
    }
}
