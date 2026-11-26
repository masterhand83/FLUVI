//! v1-compatible map palette, shared by live display and captures.
use crate::virtual_time::Clock;
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MapBackground {
    #[default]
    Sky,
    Blue,
    Guinda,
    Grey,
    White,
    Custom([u8; 3]),
}

impl MapBackground {
    pub const PRESETS: [Self; 5] = [Self::Sky, Self::Blue, Self::Guinda, Self::Grey, Self::White];

    pub fn code(self) -> &'static str {
        match self {
            Self::Sky => "sky",
            Self::Blue => "blue",
            Self::Guinda => "guinda",
            Self::Grey => "grey",
            Self::White => "white",
            Self::Custom(_) => "custom",
        }
    }

    pub fn base(self) -> [u8; 3] {
        match self {
            Self::Sky => [106, 160, 240],
            Self::Blue => [30, 58, 138],
            Self::Guinda => [122, 31, 61],
            Self::Grey => [198, 203, 205],
            Self::White => [255; 3],
            Self::Custom(rgb) => rgb,
        }
    }

    pub fn from_json(value: &Value) -> Self {
        match value["preset"].as_str() {
            Some("blue") => Self::Blue,
            Some("guinda") => Self::Guinda,
            Some("grey") => Self::Grey,
            Some("white") => Self::White,
            Some("custom") => {
                let color = &value["color"];
                let parsed = color
                    .as_u64()
                    .filter(|n| *n <= 0xffffff)
                    .map(|n| n as u32)
                    .or_else(|| {
                        let text = color.as_str()?.trim();
                        let text = text.strip_prefix('#').unwrap_or(text);
                        (text.len() == 6 && text.bytes().all(|b| b.is_ascii_hexdigit()))
                            .then(|| u32::from_str_radix(text, 16).ok())
                            .flatten()
                    });
                parsed
                    .map(|n| Self::Custom([(n >> 16) as u8, (n >> 8) as u8, n as u8]))
                    .unwrap_or_default()
            }
            _ => Self::Sky,
        }
    }

    pub fn to_json(self) -> Value {
        let [r, g, b] = self.base();
        json!({"preset": self.code(), "color": format!("#{r:02x}{g:02x}{b:02x}")})
    }

    pub fn rgb(self, clock: Clock) -> [u8; 3] {
        const SKY: [u32; 25] = [
            0x12163a, 0x121843, 0x121b4c, 0x111d56, 0x0f205f, 0x0c2269, 0xbed5f9, 0x90b8f4,
            0x6aa0f0, 0x6aa0f0, 0x6aa0f0, 0x6aa0f0, 0x6aa0f0, 0x6aa0f0, 0x6aa0f0, 0x6aa0f0,
            0x6aa0f0, 0x6190d8, 0x0c2269, 0x0f205f, 0x111d56, 0x121b4c, 0x121843, 0x12163a,
            0x121331,
        ];
        let [_, hour, minute, _] = clock.parts();
        let channels = |n: u32| [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        let a = channels(SKY[hour as usize]);
        let b = channels(SKY[hour as usize + 1]);
        // Keep v1's floating-point operation order, including the subtraction.
        // Reordering this expression changes rounding at some minute values.
        let exact_hour = f64::from(hour) + f64::from(minute) / 60.;
        let progress = exact_hour - f64::from(hour);
        let sky = std::array::from_fn(|i| {
            (f64::from(a[i]) + (f64::from(b[i]) - f64::from(a[i])) * progress).round() as u8
        });
        if self == Self::Sky {
            return sky;
        }
        let luminance = |[r, g, b]: [u8; 3]| {
            0.2126 * f64::from(r) + 0.7152 * f64::from(g) + 0.0722 * f64::from(b)
        };
        let shade = 0.35 + 0.65 * (luminance(sky) / luminance(Self::Sky.base())).clamp(0., 1.);
        self.base().map(|c| (f64::from(c) * shade).round() as u8)
    }
}
