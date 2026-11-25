//! Curve-point selection and drag preview. Commit only on release, through StreetEdit.
use crate::preview::GeometryPreview;
use ca_core::{
    bezier::{BezierChange, BezierCurve, CurvePoint},
    camera::Camera,
    geometry::CellGeometry,
    map_json::MapDocument,
    streets::{StreetChange, StreetEdit, StreetError},
};
use eframe::egui;
use std::sync::Arc;

fn curve_preview(
    street: usize,
    curve: &BezierCurve,
    lanes: usize,
    shift: [f32; 2],
    ui: &egui::Ui,
    rect: egui::Rect,
    camera: &Camera,
) -> GeometryPreview {
    let error = curve.validate(lanes).err();
    let length = curve.cell_count().clamp(1, 2500);
    let mut geometry = CellGeometry {
        centers: vec![vec![[0.0; 2]; length]; lanes],
        axes: vec![vec![[0.0; 2]; length]; lanes],
    };
    for lane in 0..lanes {
        for index in 0..length {
            let (center, axis) = curve.cell(lane, lanes, index);
            geometry.centers[lane][index] = std::array::from_fn(|i| center[i] + shift[i]);
            geometry.axes[lane][index] = axis;
        }
    }
    GeometryPreview::new(street, geometry, error, ui, rect, camera)
}

struct Drag {
    street: usize,
    point: CurvePoint,
    original: [f32; 2],
    position: [f32; 2],
    error: Option<StreetError>,
}

struct Handle {
    street: usize,
    point: CurvePoint,
    position: [f32; 2],
}

struct Guide {
    street: usize,
    points: Vec<(CurvePoint, [f32; 2])>,
}

#[derive(Default)]
pub(crate) struct CurveEditor {
    handles: Vec<Handle>,
    guides: Vec<Guide>,
    selected: Option<(usize, CurvePoint)>,
    curves: Vec<Option<(BezierCurve, usize)>>,
    drag: Option<Drag>,
    preview: Option<Arc<GeometryPreview>>,
    shift: [f32; 2],
}

#[derive(Default)]
pub(crate) struct CurveInput {
    pub edit: Option<StreetEdit>,
    pub handled: bool,
    pub active: bool,
    pub preview: Option<Arc<GeometryPreview>>,
    pub error: Option<StreetError>,
}

impl CurveEditor {
    pub fn sync(&mut self, document: &MapDocument, shift: [f32; 2]) {
        self.shift = shift;
        self.drag = None;
        self.preview = None;
        self.curves = document
            .layout()
            .iter()
            .zip(document.model().streets())
            .map(|(p, s)| p.bezier.clone().map(|curve| (curve, s.config().carriles)))
            .collect();
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
                self.guides.push(Guide {
                    street,
                    points: [(
                        if i == 0 {
                            CurvePoint::Start
                        } else {
                            CurvePoint::Anchor(i - 1)
                        },
                        start,
                    )]
                    .into_iter()
                    .chain(
                        s.controls
                            .iter()
                            .copied()
                            .enumerate()
                            .map(|(j, p)| (CurvePoint::Control(i, j), p)),
                    )
                    .chain([(CurvePoint::Anchor(i), s.end)])
                    .map(|(point, p)| (point, shifted(p)))
                    .collect(),
                });
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
        self.preview = None;
        self.selected = None;
    }

    pub fn previewing(&self) -> bool {
        self.preview.is_some()
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
        if !enabled
            || self
                .drag
                .as_ref()
                .is_some_and(|d| Some(d.street) != selected)
            || ui.input(|i| {
                !i.focused
                    || i.key_pressed(egui::Key::Escape)
                    || i.multi_touch().is_some()
                    || i.events
                        .iter()
                        .any(|e| matches!(e, egui::Event::WindowFocused(false)))
            })
        {
            result.handled = self.drag.is_some();
            self.drag = None;
            self.preview = None;
            return result;
        }
        if pointer.primary_pressed()
            && !ui.input(|i| i.modifiers.ctrl)
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
                self.drag = Some(Drag {
                    street: h.street,
                    point: h.point,
                    original: h.position,
                    position: h.position,
                    error: None,
                });
            } else {
                self.selected = None;
            }
        }
        if let Some(drag) = &mut self.drag {
            result.handled = true;
            result.active = true;
            if let Some(pos) = pointer.interact_pos().filter(|p| rect.contains(*p)) {
                let position = camera.screen_to_world((pos - rect.min).into());
                if position != drag.position
                    || self
                        .preview
                        .as_ref()
                        .is_some_and(|p| !p.matches_view(ui, rect, camera))
                {
                    drag.position = position;
                    let world = std::array::from_fn(|i| (position[i] - self.shift[i]) as f64);
                    let (curve, lanes) = self.curves[drag.street].as_ref().expect("curve handle");
                    match curve.changed(&BezierChange::Move(drag.point, world)) {
                        Ok(candidate) => {
                            let preview = curve_preview(
                                drag.street,
                                &candidate,
                                *lanes,
                                self.shift,
                                ui,
                                rect,
                                camera,
                            );
                            drag.error = preview.error;
                            self.preview = Some(Arc::new(preview));
                        }
                        Err(error) => {
                            drag.error = Some(error);
                            self.preview = None;
                        }
                    }
                }
            }
            result.error = drag.error;
            if pointer.primary_released() {
                if pointer.interact_pos().is_some_and(|p| rect.contains(p))
                    && drag.error.is_none()
                    && drag.position != drag.original
                {
                    let world = std::array::from_fn(|i| (drag.position[i] - self.shift[i]) as f64);
                    result.edit = Some(StreetEdit::Update(
                        drag.street,
                        StreetChange::Bezier(BezierChange::Move(drag.point, world)),
                    ));
                }
                self.drag = None;
                self.preview = None;
            }
        }
        result.preview = self.preview.clone();
        result
    }

    pub fn paint(
        &self,
        painter: &egui::Painter,
        rect: egui::Rect,
        camera: &Camera,
        selected: Option<usize>,
        translation: [f32; 2],
    ) {
        let screen = |p| {
            let p: [f32; 2] = p;
            let p = camera.world_to_screen(std::array::from_fn(|i| p[i] + translation[i]));
            rect.min + egui::vec2(p[0], p[1])
        };
        let dragged = self.drag.as_ref().filter(|d| Some(d.street) == selected);
        for guide in self.guides.iter().filter(|g| Some(g.street) == selected) {
            let position = |(point, p)| {
                dragged
                    .filter(|d| d.point == point)
                    .map_or(p, |d| d.position)
            };
            for pair in guide.points.windows(2) {
                let invalid = dragged.is_some_and(|d| {
                    d.error.is_some() && pair.iter().any(|(point, _)| *point == d.point)
                });
                painter.line_segment(
                    [screen(position(pair[0])), screen(position(pair[1]))],
                    egui::Stroke::new(
                        1.0_f32,
                        if invalid {
                            egui::Color32::RED
                        } else {
                            egui::Color32::GRAY
                        },
                    ),
                );
            }
        }
        for h in self.handles.iter().filter(|h| Some(h.street) == selected) {
            let pos = if let Some(drag) = self
                .drag
                .as_ref()
                .filter(|d| d.street == h.street && d.point == h.point)
            {
                screen(drag.position)
            } else {
                screen(h.position)
            };
            painter.circle_filled(
                pos,
                5.0,
                if dragged.is_some_and(|d| d.point == h.point && d.error.is_some()) {
                    egui::Color32::RED
                } else if self.selected == Some((h.street, h.point)) {
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
