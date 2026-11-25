//! Street drafts in cell-sized world units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RoundaboutDraft {
    pub center: [f64; 2],
    pub inner_radius: f64,
    pub start_angle: f64,
}

impl RoundaboutDraft {
    pub fn new(center: [f64; 2], inner_radius: f64, start_angle: f64) -> Result<Self, StreetError> {
        let draft = Self {
            center,
            inner_radius,
            start_angle,
        };
        if !center
            .into_iter()
            .all(|v| v.is_finite() && v.abs() <= 200_000.0)
            || !inner_radius.is_finite()
            || inner_radius <= 0.0
            || !start_angle.is_finite()
            || start_angle.abs() > 1_000_000.0
            || !(3..=2500).contains(&draft.cells())
        {
            return Err(StreetError("roundaboutDrawing.invalid"));
        }
        Ok(draft)
    }

    pub fn between(center: [f64; 2], end: [f64; 2]) -> Result<Self, StreetError> {
        let dx = end[0] - center[0];
        let dy = end[1] - center[1];
        Self::new(center, dx.hypot(dy), dy.atan2(dx).to_degrees())
    }

    pub fn cells(&self) -> usize {
        (std::f64::consts::TAU * (self.inner_radius + 0.5)).round() as usize
    }
}

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
    DrawRoundabout(RoundaboutDraft),
    Delete(usize),
    Update(usize, StreetChange),
}

#[derive(Clone, Debug, PartialEq)]
pub enum StreetChange {
    /// Atomic endpoint edit, in cell-sized world units.
    StraightGeometry {
        origin: [f64; 2],
        angle: f64,
        length: usize,
    },
    Bezier(crate::bezier::BezierChange),
    /// Inner radius in cell-sized world units.
    Radius(f64),
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
        if let Self::StraightGeometry {
            origin,
            angle,
            length,
        } = self
        {
            Self::Origin(*origin).validate(config)?;
            Self::Angle(*angle).validate(config)?;
            return Self::Dimensions {
                lanes: config.carriles,
                length: *length,
            }
            .validate(config);
        }
        let key = match self {
            Self::Radius(v) if RoundaboutDraft::new([0.0; 2], *v, 0.0).is_err() => {
                "roundaboutDrawing.invalid"
            }
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

/// Nearest sector center, with clockwise tie breaking, as in v1.
pub(crate) fn angular_index(index: usize, old: usize, new: usize) -> usize {
    (((index as f64 + 0.5) * new as f64 / old as f64 - 0.5 + new as f64).round() as usize) % new
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreetEvent {
    Drawn(usize),
    Deleted(usize),
    Updated(usize),
    LaneDirectionsChanged(usize),
}
