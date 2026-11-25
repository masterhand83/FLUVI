//! Curve-point selection and drag preview. Commit only on release, through StreetEdit.
use ca_core::{
    bezier::{BezierChange, CurvePoint},
    camera::Camera,
    map_json::MapDocument,
    streets::{StreetChange, StreetEdit},
};
use eframe::egui;

struct Handle {
    street: usize,
    point: CurvePoint,
    position: [f32; 2],
}

#[derive(Default)]
pub(crate) struct CurveEditor {
    handles: Vec<Handle>,
    guides: Vec<(usize, Vec<[f32; 2]>)>,
    selected: Option<(usize, CurvePoint)>,
    drag: Option<(usize, CurvePoint, [f32; 2])>,
    shift: [f32; 2],
}

#[derive(Default)]
pub(crate) struct CurveInput {
    pub edit: Option<StreetEdit>,
    pub handled: bool,
    pub active: bool,
}

impl CurveEditor {
    pub fn sync(&mut self, document: &MapDocument, shift: [f32; 2]) {
        self.shift = shift;
        self.handles.clear();
        self.guides.clear();
        let shifted = |p: [f64; 2]| std::array::from_fn(|i| p[i] as f32 + shift[i]);
        for (street, p) in document.layout().iter().enumerate() {
            let Some(curve) = &p.bezier else {
                continue;
            };
            self.handles.push(Handle {
                street,
                point: CurvePoint::Start,
                position: shifted(curve.start()),
            });
            let mut start = curve.start();
            for (i, s) in curve.sections().iter().enumerate() {
                self.guides.push((
                    street,
                    [start]
                        .into_iter()
                        .chain(s.controls.iter().copied())
                        .chain([s.end])
                        .map(shifted)
                        .collect(),
                ));
                self.handles.push(Handle {
                    street,
                    point: CurvePoint::Anchor(i),
                    position: shifted(s.end),
                });
                for (j, &point) in s.controls.iter().enumerate() {
                    self.handles.push(Handle {
                        street,
                        point: CurvePoint::Control(i, j),
                        position: shifted(point),
                    });
                }
                start = s.end;
            }
        }
        if self
            .selected
            .is_some_and(|(s, p)| !self.handles.iter().any(|h| h.street == s && h.point == p))
        {
            self.selected = None;
        }
    }

    pub fn selection(&self, street: Option<usize>) -> Option<CurvePoint> {
        self.selected
            .filter(|(s, _)| Some(*s) == street)
            .map(|(_, p)| p)
    }

    pub fn select(&mut self, street: Option<usize>, point: Option<CurvePoint>) {
        self.selected = street.zip(point);
    }

    pub fn finish(&mut self) {
        self.drag = None;
        self.selected = None;
    }

    pub fn input(
        &mut self,
        ui: &egui::Ui,
        rect: egui::Rect,
        camera: &Camera,
        selected: Option<usize>,
        enabled: bool,
        owns_pointer: bool,
    ) -> CurveInput {
        let mut result = CurveInput::default();
        let pointer = ui.input(|i| i.pointer.clone());
        if !enabled || ui.input(|i| i.key_pressed(egui::Key::Escape) || i.multi_touch().is_some()) {
            result.handled = self.drag.is_some();
            self.drag = None;
            return result;
        }
        if pointer.primary_pressed()
            && owns_pointer
            && let Some(pos) = pointer.interact_pos().filter(|p| rect.contains(*p))
        {
            let candidate = self
                .handles
                .iter()
                .filter(|h| Some(h.street) == selected)
                .map(|h| {
                    let p = camera.world_to_screen(h.position);
                    (h, pos.distance(rect.min + egui::vec2(p[0], p[1])))
                })
                .filter(|(_, d)| *d <= 10.0)
                .min_by(|a, b| a.1.total_cmp(&b.1));
            if let Some((h, _)) = candidate {
                self.selected = Some((h.street, h.point));
                self.drag = Some((h.street, h.point, h.position));
            } else {
                self.selected = None;
            }
        }
        if let Some((street, point, original)) = self.drag {
            result.handled = true;
            result.active = true;
            if pointer.primary_released() {
                if let Some(pos) = pointer.interact_pos().filter(|p| rect.contains(*p)) {
                    let position = camera.screen_to_world((pos - rect.min).into());
                    if position != original {
                        let world = std::array::from_fn(|i| (position[i] - self.shift[i]) as f64);
                        result.edit = Some(StreetEdit::Update(
                            street,
                            StreetChange::Bezier(BezierChange::Move(point, world)),
                        ));
                    }
                }
                self.drag = None;
            }
        }
        result
    }

    pub fn paint(
        &self,
        painter: &egui::Painter,
        rect: egui::Rect,
        camera: &Camera,
        selected: Option<usize>,
    ) {
        let screen = |p| {
            let p = camera.world_to_screen(p);
            rect.min + egui::vec2(p[0], p[1])
        };
        for (_, guide) in self.guides.iter().filter(|(s, _)| Some(*s) == selected) {
            for pair in guide.windows(2) {
                painter.line_segment(
                    [screen(pair[0]), screen(pair[1])],
                    egui::Stroke::new(1.0_f32, egui::Color32::GRAY),
                );
            }
        }
        for h in self.handles.iter().filter(|h| Some(h.street) == selected) {
            let pos = if self
                .drag
                .is_some_and(|(s, p, _)| s == h.street && p == h.point)
            {
                painter
                    .ctx()
                    .input(|i| i.pointer.interact_pos())
                    .unwrap_or_else(|| screen(h.position))
            } else {
                screen(h.position)
            };
            painter.circle_filled(
                pos,
                5.0,
                if self.selected == Some((h.street, h.point)) {
                    egui::Color32::WHITE
                } else if matches!(h.point, CurvePoint::Control(_, _)) {
                    egui::Color32::LIGHT_BLUE
                } else {
                    egui::Color32::YELLOW
                },
            );
        }
    }
}
