//! Retained world-space functional-parking overlays. Names and artwork are inert.
use ca_core::{camera::WorldView, map_json::MapDocument};
use eframe::egui;

/// Color-blind-safe blue/orange, reinforced by circle/square street markers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EndpointKind {
    Entrance,
    Exit,
}

impl EndpointKind {
    pub fn color(self) -> egui::Color32 {
        match self {
            Self::Entrance => egui::Color32::from_rgb(86, 180, 233),
            Self::Exit => egui::Color32::from_rgb(230, 159, 0),
        }
    }

    pub fn label_key(self) -> &'static str {
        match self {
            Self::Entrance => "parking.ui.entry",
            Self::Exit => "parking.ui.exit",
        }
    }

    pub fn symbol(self) -> &'static str {
        match self {
            Self::Entrance => "●",
            Self::Exit => "■",
        }
    }

    pub(crate) fn pick_hint_key(self) -> &'static str {
        match self {
            Self::Entrance => "parking.ui.pickEntryHint",
            Self::Exit => "parking.ui.pickExitHint",
        }
    }

    pub(crate) fn paint_marker(self, painter: &egui::Painter, point: egui::Pos2) {
        let halo = egui::Color32::from_black_alpha(210);
        match self {
            Self::Entrance => {
                painter.circle_filled(point, 4., halo);
                painter.circle_filled(point, 2.5, self.color());
            }
            Self::Exit => {
                painter.rect_filled(
                    egui::Rect::from_center_size(point, egui::vec2(8., 8.)),
                    0.,
                    halo,
                );
                painter.rect_filled(
                    egui::Rect::from_center_size(point, egui::vec2(5., 5.)),
                    0.,
                    self.color(),
                );
            }
        }
    }
}

fn paint_link(painter: &egui::Painter, a: egui::Pos2, b: egui::Pos2, kind: EndpointKind) {
    let delta = b - a;
    let length = delta.length();
    if length > 0.01 {
        let direction = delta / length;
        let perpendicular = egui::vec2(-direction.y, direction.x);
        // Heads stay small at every zoom level, unlike Painter::arrow's
        // proportional heads. Short links cannot overshoot their source.
        let head = 5_f32.min(length * 0.4);
        let base = b - direction * head;
        let segments = [
            [a, b],
            [b, base + perpendicular * head * 0.5],
            [b, base - perpendicular * head * 0.5],
        ];
        for (width, color) in [
            (3., egui::Color32::from_black_alpha(190)),
            (1.25_f32, kind.color()),
        ] {
            for segment in segments {
                painter.line_segment(segment, egui::Stroke::new(width, color));
            }
        }
    }
    kind.paint_marker(
        painter,
        match kind {
            EndpointKind::Entrance => a,
            EndpointKind::Exit => b,
        },
    );
}

#[derive(Default)]
pub struct ParkingOverlays {
    pub items: Vec<ParkingOverlay>,
}

pub struct ParkingOverlay {
    pub building: usize,
    pub center: [f32; 2],
    pub outline: Vec<[f32; 2]>,
    pub links: Vec<ParkingLink>,
    capacity: usize,
    occupied: usize,
    counter: String,
}

pub struct ParkingLink {
    pub kind: EndpointKind,
    /// Entrance: street → building. Exit: building → street.
    pub endpoints: [[f32; 2]; 2],
}

impl ParkingOverlay {
    pub fn counter(&self) -> &str {
        &self.counter
    }
}

impl ParkingOverlays {
    pub fn refresh(&mut self, document: &MapDocument, shift: [f32; 2]) {
        let mut next = Self::from_document(document, shift);
        for item in &mut next.items {
            if let Some(old) = self.items.iter().find(|old| old.building == item.building) {
                item.occupied = old.occupied;
                item.counter = format!("({}/{})", item.occupied, item.capacity);
            }
        }
        *self = next;
    }

    pub fn delete_building(&mut self, building: usize) {
        self.items.retain(|item| item.building != building);
        for item in &mut self.items {
            if item.building > building {
                item.building -= 1;
            }
        }
    }

    pub fn reset_occupancy(&mut self) {
        for item in &mut self.items {
            item.occupied = 0;
            item.counter = format!("(0/{})", item.capacity);
        }
    }

    pub fn from_document(document: &MapDocument, shift: [f32; 2]) -> Self {
        let point = |p: [f64; 2]| std::array::from_fn(|i| p[i] as f32 / 5. + shift[i]);
        let mut items = Vec::new();
        for (building, shape) in document.buildings().iter().enumerate() {
            let Some(parking) = document.model().parking(building) else {
                continue;
            };
            let center = point(shape.center);
            let mut links = Vec::new();
            for pair in &parking.config.pairs {
                for (cell, entrance) in [(pair.entrance, true), (pair.exit, false)] {
                    let street = &document.model().streets()[cell.street];
                    let placement = &document.layout()[cell.street];
                    let cells = placement.cells(street.config().carriles, street.config().tamano);
                    let endpoint =
                        std::array::from_fn(|i| cells.centers[cell.lane][cell.index][i] + shift[i]);
                    links.push(ParkingLink {
                        kind: if entrance {
                            EndpointKind::Entrance
                        } else {
                            EndpointKind::Exit
                        },
                        endpoints: if entrance {
                            [endpoint, center]
                        } else {
                            [center, endpoint]
                        },
                    });
                }
            }
            items.push(ParkingOverlay {
                building,
                center,
                outline: shape.points().into_iter().map(point).collect(),
                links,
                capacity: parking.config.capacity,
                occupied: parking.occupied(),
                counter: format!("({}/{})", parking.occupied(), parking.config.capacity),
            });
        }
        Self { items }
    }

    pub fn set_occupancy(&mut self, building: usize, occupied: usize) {
        if let Some(item) = self.items.iter_mut().find(|item| item.building == building)
            && item.occupied != occupied
        {
            item.occupied = occupied;
            item.counter = format!("({occupied}/{})", item.capacity);
        }
    }

    pub fn paint(&self, painter: &egui::Painter, rect: egui::Rect, view: WorldView) {
        let painter = painter.with_clip_rect(rect);
        let screen = |p: [f32; 2]| {
            egui::pos2(
                rect.left() + (p[0] - view.origin[0]) / view.span[0] * rect.width(),
                rect.top() + (p[1] - view.origin[1]) / view.span[1] * rect.height(),
            )
        };
        let stroke = egui::Stroke::new(2_f32, egui::Color32::LIGHT_BLUE);
        for item in &self.items {
            for (a, b) in item.outline.iter().zip(item.outline.iter().cycle().skip(1)) {
                painter.line_segment([screen(*a), screen(*b)], stroke);
            }
            for link in &item.links {
                let [a, b] = link.endpoints.map(screen);
                paint_link(&painter, a, b, link.kind);
            }
            painter.text(
                screen(item.center),
                egui::Align2::CENTER_CENTER,
                item.counter(),
                egui::FontId::proportional(14.),
                egui::Color32::WHITE,
            );
        }
    }
}
