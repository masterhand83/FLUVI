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

#[derive(Clone, Debug, PartialEq)]
pub enum StreetEdit {
    Draw(StreetDraft),
    Delete(usize),
    Update(usize, StreetChange),
}

#[derive(Clone, Debug, PartialEq)]
pub enum StreetChange {
    Dimensions {
        lanes: usize,
        length: usize,
    },
    Direction {
        lane: usize,
        direction: crate::traffic::LaneDirection,
    },
    Name(String),
    /// Cell-sized world coordinates, as used by StreetPlacement.
    Origin([f64; 2]),
    Angle(f64),
    Type(crate::traffic::CalleType),
    Generation(f64),
    LaneChange(f64),
    LaneGeneration {
        lane: usize,
        enabled: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("invalid street edit: {0}")]
pub struct StreetError(pub &'static str);

impl StreetError {
    pub fn translation_key(self) -> &'static str {
        self.0
    }
}

impl StreetChange {
    pub fn validate(&self, config: &crate::traffic::CalleConfig) -> Result<(), StreetError> {
        let key = match self {
            Self::Name(name) if name.trim().is_empty() => "streetInspector.errors.name",
            Self::Dimensions { lanes, .. } if !(1..=10).contains(lanes) => {
                "streetInspector.errors.lanes"
            }
            Self::Dimensions { length, .. } if !(1..=2500).contains(length) => {
                "streetInspector.errors.length"
            }
            Self::Direction { lane, .. } | Self::LaneGeneration { lane, .. }
                if *lane >= config.carriles =>
            {
                "streetInspector.errors.lanes"
            }
            Self::Origin(p) if p.iter().any(|v| !v.is_finite() || v.abs() > 200_000.0) => {
                "streetInspector.errors.geometry"
            }
            Self::Angle(v) if !v.is_finite() || v.abs() > 1_000_000.0 => {
                "streetInspector.errors.geometry"
            }
            Self::Generation(v) | Self::LaneChange(v)
                if !v.is_finite() || !(0.0..=1.0).contains(v) =>
            {
                "streetInspector.errors.probability"
            }
            _ => return Ok(()),
        };
        Err(StreetError(key))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreetEvent {
    Drawn(usize),
    Deleted(usize),
    Updated(usize),
    LaneDirectionsChanged(usize),
}
