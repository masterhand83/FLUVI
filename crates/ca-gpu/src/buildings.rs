//! Building geometry uses the same GPU triangle path as static map zones.
use ca_core::{buildings::Building, map_json::BackgroundZone};

pub fn building_zone(building: &Building) -> BackgroundZone {
    BackgroundZone {
        points: building
            .points()
            .into_iter()
            .map(|p| p.map(|n| (n / 5.) as f32))
            .collect(),
        color: if building.is_image() {
            [0; 4]
        } else {
            color(&building.color)
        },
        label: String::new(),
        show_label: false,
        show_border: !building.is_image(),
    }
}

fn color(text: &str) -> [u8; 4] {
    let text = text.trim_start_matches('#');
    if (text.len() == 6 || text.len() == 8)
        && text.is_ascii()
        && let Ok(n) = u32::from_str_radix(text, 16)
    {
        let (rgb, alpha) = if text.len() == 8 {
            (n >> 8, n as u8)
        } else {
            (n, 255)
        };
        return [(rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8, alpha];
    }
    [139, 69, 19, 255]
}
