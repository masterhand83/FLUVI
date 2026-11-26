//! Session-only label display. Geometry is in unshifted cell-sized world units.
use crate::shell::Shell;
use ca_core::map_json::StreetPlacement;
use ca_core::{camera::WorldView, map_json::MapDocument};
use eframe::egui;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Visibility {
    #[default]
    Off,
    Streets,
    Buildings,
    Both,
}

impl Visibility {
    fn key(self) -> &'static str {
        match self {
            Self::Off => "labels.off",
            Self::Streets => "labels.streets",
            Self::Buildings => "labels.buildings",
            Self::Both => "labels.both",
        }
    }
}

pub struct Labels {
    pub visibility: Visibility,
    font_size: u32,
    size_input: String,
    invalid_size: bool,
    revision: Option<(u64, [f32; 2])>,
    streets: Vec<(String, LabelAnchor)>,
    buildings: Vec<(String, LabelAnchor)>,
}

impl Default for Labels {
    fn default() -> Self {
        Self {
            visibility: Visibility::Off,
            font_size: 14,
            size_input: "14".into(),
            invalid_size: false,
            revision: None,
            streets: vec![],
            buildings: vec![],
        }
    }
}

impl Labels {
    pub fn font_size(&self) -> u32 {
        self.font_size
    }

    pub fn set_font_size(&mut self, text: &str) -> Result<(), &'static str> {
        let size = text
            .parse::<u32>()
            .ok()
            .filter(|n| *n > 0)
            .ok_or("labels.invalidSize")?;
        self.font_size = size;
        Ok(())
    }

    pub fn show_tools(&mut self, ui: &mut egui::Ui, shell: &Shell) {
        egui::ComboBox::from_id_salt("map-labels")
            .selected_text(shell.tr(self.visibility.key(), &[]))
            .show_ui(ui, |ui| {
                for value in [
                    Visibility::Off,
                    Visibility::Streets,
                    Visibility::Buildings,
                    Visibility::Both,
                ] {
                    ui.selectable_value(&mut self.visibility, value, shell.tr(value.key(), &[]));
                }
            })
            .response
            .on_hover_text(shell.tr("labels.title", &[]));
        ui.label(shell.tr("labels.size", &[]));
        if ui.text_edit_singleline(&mut self.size_input).changed() {
            let input = self.size_input.clone();
            self.invalid_size = self.set_font_size(&input).is_err();
        }
        if self.invalid_size {
            ui.colored_label(
                egui::Color32::LIGHT_RED,
                shell.tr("labels.invalidSize", &[]),
            );
        }
    }

    /// Clear retained geometry on New/Open; display settings are not map data.
    pub fn invalidate_geometry(&mut self) {
        self.revision = None;
    }

    pub fn sync(&mut self, document: &MapDocument, revision: u64, shift: [f32; 2]) {
        if self.revision == Some((revision, shift)) {
            return;
        }
        self.streets = document
            .layout()
            .iter()
            .zip(document.model().streets())
            .map(|(road, model)| {
                let mut anchor = street_label(road, model.config().carriles, model.config().tamano);
                for (i, value) in shift.into_iter().enumerate() {
                    anchor.position[i] += value;
                }
                (road.name.clone(), anchor)
            })
            .collect();
        self.buildings = document
            .buildings()
            .iter()
            .map(|building| {
                (
                    building.label.clone(),
                    LabelAnchor {
                        position: std::array::from_fn(|i| {
                            building.center[i] as f32 / 5. + shift[i]
                        }),
                        angle: 0.,
                    },
                )
            })
            .collect();
        self.revision = Some((revision, shift));
    }

    pub fn paint(&self, painter: &egui::Painter, view: WorldView, rect: egui::Rect) {
        let painter = painter.with_clip_rect(rect);
        let streets = matches!(self.visibility, Visibility::Streets | Visibility::Both);
        let buildings = matches!(self.visibility, Visibility::Buildings | Visibility::Both);
        let font = crate::shell::label_font(
            painter.ctx(),
            self.font_size as f32 / painter.ctx().pixels_per_point(),
        );
        for (text, anchor) in self
            .streets
            .iter()
            .filter(|_| streets)
            .chain(self.buildings.iter().filter(|_| buildings))
        {
            if text.is_empty() {
                continue;
            }
            let center = rect.min
                + egui::vec2(
                    (anchor.position[0] - view.origin[0]) / view.span[0] * rect.width(),
                    (anchor.position[1] - view.origin[1]) / view.span[1] * rect.height(),
                );
            // Layout at the output pixel size, never scale a world-space bitmap.
            let ppp = painter.ctx().pixels_per_point();
            let galley = painter.layout_no_wrap(text.clone(), font.clone(), egui::Color32::WHITE);
            let rotation = egui::emath::Rot2::from_angle(anchor.angle);
            let half = galley.size() / 2.;
            let pos = center - rotation * half;
            let shape = egui::epaint::TextShape::new(pos, galley, egui::Color32::WHITE)
                .with_angle(anchor.angle);
            if !shape.visual_bounding_rect().expand(6.).intersects(rect) {
                continue;
            }
            let padding = egui::vec2(4., 2.) / ppp;
            let extent = half + padding;
            let radius = (3. / ppp).min(extent.y);
            let mut corners = Vec::with_capacity(20);
            for corner in 0..4 {
                let angle = corner as f32 * std::f32::consts::FRAC_PI_2;
                let offset = egui::vec2(
                    if corner == 0 || corner == 3 {
                        extent.x - radius
                    } else {
                        -extent.x + radius
                    },
                    if corner < 2 {
                        extent.y - radius
                    } else {
                        -extent.y + radius
                    },
                );
                for step in 0..=4 {
                    let a = angle + step as f32 * std::f32::consts::FRAC_PI_2 / 4.;
                    corners
                        .push(center + rotation * (offset + egui::vec2(a.cos(), a.sin()) * radius));
                }
            }
            painter.add(egui::Shape::convex_polygon(
                corners,
                egui::Color32::from_black_alpha(31),
                egui::Stroke::NONE,
            ));
            for step in 0..16 {
                let angle = step as f32 * std::f32::consts::TAU / 16.;
                let mut halo = shape.clone().with_override_text_color(egui::Color32::BLACK);
                halo.pos += egui::vec2(angle.cos(), angle.sin()) * (2. / ppp);
                painter.add(halo);
            }
            painter.add(shape);
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct LabelAnchor {
    pub position: [f32; 2],
    pub angle: f32,
}

pub fn street_label(road: &StreetPlacement, lanes: usize, length: usize) -> LabelAnchor {
    let (position, axis) = if let Some(curve) = &road.bezier {
        curve.centerline(0.5)
    } else if let Some(ring) = road.roundabout {
        let angle = ring.start_angle.to_radians() + std::f64::consts::PI;
        let radius = ring.inner_radius + lanes as f64 / 2.;
        (
            [
                (ring.center[0] + radius * angle.cos()) as f32,
                (ring.center[1] + radius * angle.sin()) as f32,
            ],
            [-angle.sin() as f32, angle.cos() as f32],
        )
    } else if road.curved && road.vertices.len() >= 2 {
        legacy_midpoint(road, length)
    } else {
        let angle = -road.angle_degrees.to_radians();
        let axis = [angle.cos(), angle.sin()];
        (
            [
                (road.origin[0] + axis[0] * length as f64 / 2. - axis[1] * lanes as f64 / 2.)
                    as f32,
                (road.origin[1] + axis[1] * length as f64 / 2. + axis[0] * lanes as f64 / 2.)
                    as f32,
            ],
            axis.map(|v| v as f32),
        )
    };
    let angle = (axis[1].atan2(axis[0]) + std::f32::consts::FRAC_PI_2)
        .rem_euclid(std::f32::consts::PI)
        - std::f32::consts::FRAC_PI_2;
    LabelAnchor { position, angle }
}

fn legacy_midpoint(road: &StreetPlacement, length: usize) -> ([f32; 2], [f32; 2]) {
    // A single physical lane supplies the centerline without lateral offsets.
    let geometry = road.cells(1, length);
    let centers = &geometry.centers[0];
    let axes = &geometry.axes[0];
    let start = std::array::from_fn(|i| centers[0][i] - axes[0][i] * 0.5);
    let end = std::array::from_fn(|i| centers[length - 1][i] + axes[length - 1][i] * 0.5);
    let points: Vec<[f32; 2]> = [start]
        .into_iter()
        .chain(centers.iter().copied())
        .chain([end])
        .collect();
    let distance = |a: [f32; 2], b: [f32; 2]| (b[0] - a[0]).hypot(b[1] - a[1]);
    let mut remaining = points.windows(2).map(|p| distance(p[0], p[1])).sum::<f32>() / 2.;
    for segment in points.windows(2) {
        let span = distance(segment[0], segment[1]);
        if span > 0. && remaining <= span {
            let axis = std::array::from_fn(|i| (segment[1][i] - segment[0][i]) / span);
            return (
                std::array::from_fn(|i| segment[0][i] + axis[i] * remaining),
                axis,
            );
        }
        remaining -= span;
    }
    (end, axes[length - 1])
}
