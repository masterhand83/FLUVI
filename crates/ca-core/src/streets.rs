//! Straight street drafts in cell-sized world units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StreetDraft {
    pub origin: [f64; 2],
    pub angle_degrees: f64,
    pub cells: usize,
}

impl StreetDraft {
    pub fn between(origin: [f64; 2], end: [f64; 2]) -> Option<Self> {
        let dx = end[0] - origin[0];
        let dy = end[1] - origin[1];
        let distance = dx.hypot(dy);
        if !origin.into_iter().chain(end).all(f64::is_finite) || distance < 1.0 {
            return None;
        }
        Some(Self {
            origin,
            angle_degrees: -dy.atan2(dx).to_degrees(),
            cells: (distance.round() as usize).clamp(1, 2500),
        })
    }

    pub fn corners(&self) -> [[f32; 2]; 4] {
        let angle = -self.angle_degrees.to_radians();
        let axis = [angle.cos(), angle.sin()];
        [
            [0.0, 0.0],
            [self.cells as f64, 0.0],
            [self.cells as f64, 1.0],
            [0.0, 1.0],
        ]
        .map(|[x, y]| {
            [
                (self.origin[0] + axis[0] * x - axis[1] * y) as f32,
                (self.origin[1] + axis[1] * x + axis[0] * y) as f32,
            ]
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum StreetEdit {
    Draw(StreetDraft),
    Delete(usize),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreetEvent {
    Drawn(usize),
    Deleted(usize),
}
