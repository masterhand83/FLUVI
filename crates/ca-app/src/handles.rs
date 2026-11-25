//! Screen-space direct geometry handles. Saved geometry changes only on release.
use crate::preview::GeometryPreview;
use ca_core::{
    camera::Camera,
    geometry::CellGeometry,
    map_json::{MapDocument, StreetPlacement},
    streets::{StreetChange, StreetEdit, StreetError},
    traffic::CalleConfig,
};
use eframe::egui;
use std::sync::Arc;

struct Street {
    placement: StreetPlacement,
    config: CalleConfig,
    geometry: CellGeometry,
}

struct Drag {
    street: usize,
    target: Target,
    start: [f32; 2],
    moved: bool,
    position: [f64; 2],
}

enum Target {
    Endpoint(usize),
    Body,
    Radius,
}

#[derive(Default)]
pub(crate) struct GeometryHandles {
    streets: Vec<Street>,
    shift: [f32; 2],
    total: usize,
    drag: Option<Drag>,
    candidate: Option<Result<StreetChange, StreetError>>,
    preview: Option<Arc<GeometryPreview>>,
}

#[derive(Default)]
pub(crate) struct HandleInput {
    pub edit: Option<StreetEdit>,
    pub error: Option<StreetError>,
    pub handled: bool,
    pub active: bool,
    pub captured: bool,
    pub preview: Option<Arc<GeometryPreview>>,
}

impl GeometryHandles {
    pub fn sync(&mut self, document: &MapDocument, shift: [f32; 2]) {
        self.finish();
        self.shift = shift;
        self.total = document
            .model()
            .streets()
            .iter()
            .map(|s| s.cells().len())
            .sum();
        self.streets = document
            .layout()
            .iter()
            .zip(document.model().streets())
            .map(|(p, s)| Street {
                geometry: p.cells(s.config().carriles, s.config().tamano),
                placement: p.clone(),
                config: s.config().clone(),
            })
            .collect();
    }

    pub fn finish(&mut self) {
        self.drag = None;
        self.candidate = None;
        self.preview = None;
    }

    pub fn previewing(&self) -> bool {
        self.preview.is_some()
    }

    pub fn translation(&self) -> [f32; 2] {
        self.drag
            .as_ref()
            .filter(|d| matches!(d.target, Target::Body) && self.previewing())
            .map_or([0.0; 2], |d| {
                std::array::from_fn(|i| {
                    (d.position[i] - self.streets[d.street].placement.origin[i]) as f32
                })
            })
    }

    fn preview_geometry(&self, drag: &Drag, change: &StreetChange) -> CellGeometry {
        let street = &self.streets[drag.street];
        let mut geometry = match change {
            StreetChange::StraightGeometry {
                origin,
                angle,
                length,
            } => {
                let mut placement = street.placement.clone();
                placement.origin = *origin;
                placement.angle_degrees = *angle;
                placement.cells(street.config.carriles, *length)
            }
            StreetChange::Origin(origin) => CellGeometry {
                centers: street
                    .geometry
                    .centers
                    .iter()
                    .map(|lane| {
                        lane.iter()
                            .map(|p| {
                                std::array::from_fn(|i| {
                                    p[i] + (origin[i] - street.placement.origin[i]) as f32
                                })
                            })
                            .collect()
                    })
                    .collect(),
                axes: street.geometry.axes.clone(),
            },
            StreetChange::Radius(radius) => {
                let mut placement = street.placement.clone();
                let ring = placement.roundabout.as_mut().expect("radial handle");
                ring.inner_radius = *radius;
                let length = ring.cells();
                placement.cells(street.config.carriles, length)
            }
            _ => unreachable!("direct geometry edit"),
        };
        for center in geometry.centers.iter_mut().flatten() {
            for (value, shift) in center.iter_mut().zip(self.shift) {
                *value += shift;
            }
        }
        geometry
    }

    fn endpoints(street: &Street) -> Option<[[f64; 2]; 2]> {
        let p = &street.placement;
        if p.curved || p.roundabout.is_some() {
            return None;
        }
        let a = -p.angle_degrees.to_radians();
        Some([
            p.origin,
            [
                p.origin[0] + a.cos() * street.config.tamano as f64,
                p.origin[1] + a.sin() * street.config.tamano as f64,
            ],
        ])
    }

    fn positions(street: &Street) -> ([[f64; 2]; 2], usize) {
        if let Some(ends) = Self::endpoints(street) {
            (ends, 2)
        } else if let Some(ring) = street.placement.roundabout {
            ([ring.center, Self::radius_handle(ring)], 2)
        } else {
            ([[0.0; 2]; 2], 0)
        }
    }

    fn radius_handle(ring: ca_core::streets::RoundaboutDraft) -> [f64; 2] {
        let angle = ring.start_angle.to_radians();
        [
            ring.center[0] + ring.inner_radius * angle.cos(),
            ring.center[1] + ring.inner_radius * angle.sin(),
        ]
    }

    fn candidate(&self, drag: &Drag) -> Result<StreetChange, StreetError> {
        let street = &self.streets[drag.street];
        let endpoint = match drag.target {
            Target::Endpoint(endpoint) => endpoint,
            Target::Radius => {
                let ring = street.placement.roundabout.expect("radial handle");
                let radius =
                    (drag.position[0] - ring.center[0]).hypot(drag.position[1] - ring.center[1]);
                let ring =
                    ca_core::streets::RoundaboutDraft::new(ring.center, radius, ring.start_angle)?;
                ca_core::streets::validate_cell_capacity(
                    self.total,
                    street.config.carriles * street.config.tamano,
                    street.config.carriles * ring.cells(),
                )?;
                return Ok(StreetChange::Radius(radius));
            }
            Target::Body => {
                let change = StreetChange::Origin(drag.position);
                change.validate(&street.config)?;
                if let Some(curve) = &street.placement.bezier {
                    curve.validate_translation(drag.position)?;
                }
                return Ok(change);
            }
        };
        let mut ends = Self::endpoints(street).expect("straight endpoint");
        ends[endpoint] = drag.position;
        let dx = ends[1][0] - ends[0][0];
        let dy = ends[1][1] - ends[0][1];
        let distance = dx.hypot(dy);
        if !distance.is_finite() || !(1.0..=2500.0).contains(&distance) {
            return Err(StreetError("streetInspector.errors.length"));
        }
        let change = StreetChange::StraightGeometry {
            origin: ends[0],
            angle: -dy.atan2(dx).to_degrees(),
            length: distance.round() as usize,
        };
        change.validate(&street.config)?;
        ca_core::streets::validate_cell_capacity(
            self.total,
            street.config.carriles * street.config.tamano,
            street.config.carriles * distance.round() as usize,
        )?;
        Ok(change)
    }

    pub fn input(
        &mut self,
        ui: &egui::Ui,
        rect: egui::Rect,
        camera: &Camera,
        selection: (Option<usize>, Option<usize>),
        enabled: bool,
        owns_pointer: bool,
    ) -> HandleInput {
        let (selected, body_hit) = selection;
        let mut result = HandleInput::default();
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
            self.finish();
            return result;
        }
        let pointer = ui.input(|i| i.pointer.clone());
        if pointer.primary_pressed()
            && !ui.input(|i| i.modifiers.ctrl)
            && owns_pointer
            && let Some(pos) = pointer.interact_pos().filter(|p| rect.contains(*p))
            && let Some(street) = selected.filter(|s| *s < self.streets.len())
        {
            let placement = &self.streets[street].placement;
            let (ends, count) = Self::positions(&self.streets[street]);
            let endpoint = ends[..count]
                .iter()
                .enumerate()
                .map(|(i, p)| {
                    let screen = camera
                        .world_to_screen(std::array::from_fn(|j| p[j] as f32 + self.shift[j]));
                    (i, pos.distance(rect.min + egui::vec2(screen[0], screen[1])))
                })
                .filter(|(_, d)| *d <= 10.0)
                .min_by(|a, b| a.1.total_cmp(&b.1));
            let straight = Self::endpoints(&self.streets[street]).is_some();
            if endpoint.is_some() || body_hit == Some(street) {
                let target = match endpoint {
                    Some((i, _)) if straight => Target::Endpoint(i),
                    Some((1, _)) => Target::Radius,
                    _ => Target::Body,
                };
                let position = match target {
                    Target::Body => placement.origin,
                    _ => ends[endpoint.expect("picked handle").0],
                };
                self.drag = Some(Drag {
                    street,
                    target,
                    start: (pos - rect.min).into(),
                    moved: false,
                    position,
                });
                self.candidate = None;
                self.preview = None;
            }
        }
        if let Some(drag) = &mut self.drag {
            result.captured = true;
            if let Some(pos) = pointer.interact_pos() {
                let local = pos - rect.min;
                drag.moved |= (local - egui::vec2(drag.start[0], drag.start[1])).length() > 3.0;
                let p = camera.screen_to_world(local.into());
                let position = if !matches!(drag.target, Target::Body) {
                    std::array::from_fn(|i| (p[i] - self.shift[i]) as f64)
                } else {
                    let start = camera.screen_to_world(drag.start);
                    let origin = self.streets[drag.street].placement.origin;
                    std::array::from_fn(|i| origin[i] + (p[i] - start[i]) as f64)
                };
                if drag.position != position {
                    self.candidate = None;
                    self.preview = None;
                    drag.position = position;
                }
            }
            result.handled = !matches!(drag.target, Target::Body) || drag.moved;
            result.active = result.handled;
        }
        if let Some(drag) = &self.drag {
            if self.candidate.is_none() {
                self.candidate = Some(self.candidate(drag));
            }
            let candidate = self.candidate.as_ref().expect("validated candidate");
            result.error = candidate.as_ref().err().copied();
            if result.active
                && let Ok(change) = candidate
                && self
                    .preview
                    .as_ref()
                    .is_none_or(|p| !p.matches_view(ui, rect, camera))
            {
                self.preview = Some(Arc::new(GeometryPreview::new(
                    drag.street,
                    self.preview_geometry(drag, change),
                    None,
                    ui,
                    rect,
                    camera,
                )));
            }
            if pointer.primary_released() {
                if drag.moved && pointer.interact_pos().is_some_and(|p| rect.contains(p)) {
                    result.edit = candidate
                        .clone()
                        .ok()
                        .map(|change| StreetEdit::Update(drag.street, change));
                }
                self.finish();
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
    ) {
        let Some(street) = selected.and_then(|s| self.streets.get(s)) else {
            return;
        };
        let (mut ends, count) = Self::positions(street);
        let invalid = if let Some(drag) = &self.drag {
            match self.candidate.as_ref() {
                Some(Ok(StreetChange::StraightGeometry {
                    origin,
                    angle,
                    length,
                })) => {
                    ends[0] = *origin;
                    let angle = -angle.to_radians();
                    ends[1] = [
                        origin[0] + angle.cos() * *length as f64,
                        origin[1] + angle.sin() * *length as f64,
                    ];
                }
                Some(Ok(StreetChange::Radius(radius))) => {
                    let mut ring = street.placement.roundabout.expect("radial handle");
                    ring.inner_radius = *radius;
                    ends[1] = Self::radius_handle(ring);
                }
                _ => match drag.target {
                    Target::Endpoint(endpoint) => ends[endpoint] = drag.position,
                    Target::Radius => ends[1] = drag.position,
                    Target::Body => {
                        for p in &mut ends[..count] {
                            for (i, value) in p.iter_mut().enumerate() {
                                *value += drag.position[i] - street.placement.origin[i];
                            }
                        }
                    }
                },
            }
            self.candidate.as_ref().is_some_and(Result::is_err)
        } else {
            false
        };
        for p in &ends[..count] {
            let p = camera.world_to_screen(std::array::from_fn(|i| p[i] as f32 + self.shift[i]));
            painter.circle_filled(
                rect.min + egui::vec2(p[0], p[1]),
                6.0,
                if invalid {
                    egui::Color32::RED
                } else {
                    egui::Color32::YELLOW
                },
            );
        }
    }
}
