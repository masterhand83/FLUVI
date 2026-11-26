//! Bounded image quality presets, separate from simulation and main-map rendering.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ExportQuality {
    Performance,
    #[default]
    Balance,
    Quality,
    Ultraquality,
}

impl ExportQuality {
    pub const ALL: [Self; 4] = [
        Self::Performance,
        Self::Balance,
        Self::Quality,
        Self::Ultraquality,
    ];

    pub fn code(self) -> &'static str {
        match self {
            Self::Performance => "performance",
            Self::Balance => "balance",
            Self::Quality => "quality",
            Self::Ultraquality => "ultraquality",
        }
    }

    pub fn from_code(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|quality| quality.code() == code)
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Performance => "graphics.performance",
            Self::Balance => "graphics.balance",
            Self::Quality => "graphics.quality",
            Self::Ultraquality => "graphics.ultraquality",
        }
    }

    pub fn width(self) -> u32 {
        match self {
            Self::Performance | Self::Balance => 1600,
            Self::Quality => 2400,
            Self::Ultraquality => 3200,
        }
    }

    pub(crate) fn samples(self) -> u32 {
        if self == Self::Performance { 1 } else { 2 }
    }

    pub(crate) fn preview_size(self) -> [usize; 2] {
        match self {
            Self::Performance => [960, 640],
            Self::Balance => [1440, 960],
            Self::Quality => [1920, 1280],
            Self::Ultraquality => [2400, 1600],
        }
    }
}
