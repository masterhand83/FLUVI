//! Shared CPU image renderer. Export never touches window state or textures.
use crate::{graphics::ExportQuality, shell::Shell};
pub use ca_core::heatmap::Snapshot as HeatmapFrame;
use eframe::egui;

const BACKGROUND: egui::Color32 = egui::Color32::from_rgb(235, 239, 242);
const HALF_LENGTH: f32 = 0.52; // Small overlap avoids seams between adjacent cells.
const HALF_WIDTH: f32 = 0.8; // Display only: 60% thicker across the lane.

fn half_extents(axis: [f32; 2]) -> [f32; 2] {
    [
        axis[0].abs() * HALF_LENGTH + axis[1].abs() * HALF_WIDTH,
        axis[1].abs() * HALF_LENGTH + axis[0].abs() * HALF_WIDTH,
    ]
}

pub(crate) fn density_color(density: f64) -> egui::Color32 {
    let stops = [
        [164_f32, 210., 181.],
        [241., 228., 171.],
        [232., 176., 176.],
    ];
    let d = density.clamp(0., 1.) as f32 * 2.;
    let segment = if d < 1. { 0 } else { 1 };
    let fraction = d - segment as f32;
    let rgb: [u8; 3] = std::array::from_fn(|i| {
        (stops[segment][i] * (1. - fraction) + stops[segment + 1][i] * fraction).round() as u8
    });
    egui::Color32::from_rgb(rgb[0], rgb[1], rgb[2])
}

/// Fit all oriented physical cells inside the requested bounds, with a small margin.
/// Each axis is capped at 4096 pixels to bound image allocation. Zero gives an empty image.
pub fn render_offscreen(frame: &HeatmapFrame, maximum: [usize; 2]) -> egui::ColorImage {
    render_offscreen_with_quality(frame, maximum, ExportQuality::default())
}

pub fn render_offscreen_with_quality(
    frame: &HeatmapFrame,
    maximum: [usize; 2],
    quality: ExportQuality,
) -> egui::ColorImage {
    render(frame, maximum, BACKGROUND, quality, 4096)
}

/// Print/export variant. Cell colors and geometry are identical to the live view.
pub fn render_on_white(frame: &HeatmapFrame, maximum: [usize; 2]) -> egui::ColorImage {
    render_on_white_with_quality(frame, maximum, ExportQuality::default())
}

/// Worker-only export raster, capped at 8192 per axis for bounded supersampling.
pub fn render_on_white_with_quality(
    frame: &HeatmapFrame,
    maximum: [usize; 2],
    quality: ExportQuality,
) -> egui::ColorImage {
    render(frame, maximum, egui::Color32::WHITE, quality, 8192)
}

fn render(
    frame: &HeatmapFrame,
    maximum: [usize; 2],
    background: egui::Color32,
    quality: ExportQuality,
    axis_limit: usize,
) -> egui::ColorImage {
    if maximum.contains(&0) {
        return egui::ColorImage::filled([0, 0], background);
    }
    let maximum = maximum.map(|v| v.min(axis_limit));
    let mut minimum = [f32::INFINITY; 2];
    let mut upper = [f32::NEG_INFINITY; 2];
    for tile in &frame.tiles {
        let radius = half_extents(tile.axis);
        for i in 0..2 {
            minimum[i] = minimum[i].min(tile.center[i] - radius[i] - 0.5);
            upper[i] = upper[i].max(tile.center[i] + radius[i] + 0.5);
        }
    }
    if frame.tiles.is_empty() {
        return egui::ColorImage::filled([1, 1], background);
    }
    let span: [f32; 2] = std::array::from_fn(|i| upper[i] - minimum[i]);
    let scale = (maximum[0] as f32 / span[0]).min(maximum[1] as f32 / span[1]);
    let size = std::array::from_fn(|i| ((span[i] * scale).ceil() as usize).clamp(1, maximum[i]));
    let mut image = egui::ColorImage::filled(size, background);
    // Wider display margins overlap. Empty cells must not cover adjacent heat;
    // obstacles remain visible above both without changing physical lane data.
    let empty = frame
        .tiles
        .iter()
        .filter(|tile| tile.density.is_none() && !tile.obstacle);
    let occupied = frame
        .tiles
        .iter()
        .filter(|tile| tile.density.is_some() && !tile.obstacle);
    let obstacles = frame.tiles.iter().filter(|tile| tile.obstacle);
    for tile in empty.chain(occupied).chain(obstacles) {
        let center: [f32; 2] = std::array::from_fn(|i| (tile.center[i] - minimum[i]) * scale);
        let radius = half_extents(tile.axis).map(|value| value * scale + 1.);
        let start: [usize; 2] =
            std::array::from_fn(|i| (center[i] - radius[i]).max(0.).floor() as usize);
        let end: [usize; 2] =
            std::array::from_fn(|i| ((center[i] + radius[i]).ceil() as usize).min(size[i]));
        let color = if tile.obstacle {
            egui::Color32::from_rgb(155, 165, 176)
        } else if let Some(density) = tile.density {
            density_color(density)
        } else {
            egui::Color32::from_rgb(198, 205, 211)
        };
        for y in start[1]..end[1] {
            for x in start[0]..end[0] {
                let dx = (x as f32 + 0.5 - center[0]) / scale;
                let dy = (y as f32 + 0.5 - center[1]) / scale;
                let distance = (HALF_LENGTH - (dx * tile.axis[0] + dy * tile.axis[1]).abs())
                    .min(HALF_WIDTH - (-dx * tile.axis[1] + dy * tile.axis[0]).abs());
                let coverage = if quality == ExportQuality::Performance {
                    if distance >= 0. { 1. } else { 0. }
                } else {
                    (distance * scale + 0.5).clamp(0., 1.)
                };
                if coverage > 0. {
                    let pixel = &mut image.pixels[y * size[0] + x];
                    let rgb: [u8; 3] = std::array::from_fn(|i| {
                        (color[i] as f32 * coverage + pixel[i] as f32 * (1. - coverage)).round()
                            as u8
                    });
                    *pixel = egui::Color32::from_rgb(rgb[0], rgb[1], rgb[2]);
                }
            }
        }
        if scale < 1. {
            let x = (center[0] as usize).min(size[0] - 1);
            let y = (center[1] as usize).min(size[1] - 1);
            image.pixels[y * size[0] + x] = color;
        }
    }
    image
}

#[derive(Default)]
pub struct HeatmapDialog {
    open: bool,
    frame: std::sync::Arc<HeatmapFrame>,
    texture: Option<egui::TextureHandle>,
    dirty: bool,
    quality: Option<ExportQuality>,
}

impl HeatmapDialog {
    pub fn open(&mut self) {
        self.open = true;
    }

    pub fn is_open(&self) -> bool {
        self.open
    }

    pub fn receive(&mut self, frame: std::sync::Arc<HeatmapFrame>) {
        self.frame = frame;
        self.dirty = true;
    }

    pub fn render_offscreen(&self, maximum: [usize; 2]) -> egui::ColorImage {
        render_offscreen_with_quality(&self.frame, maximum, self.quality.unwrap_or_default())
    }

    pub fn show(&mut self, ctx: &egui::Context, shell: &Shell) {
        if !self.open {
            return;
        }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.open = false;
            return;
        }
        let quality = shell.preferences().export_quality;
        if self.dirty || self.texture.is_none() || self.quality != Some(quality) {
            self.quality = Some(quality);
            let image = self.render_offscreen(quality.preview_size());
            if let Some(texture) = &mut self.texture {
                texture.set(image, egui::TextureOptions::LINEAR);
            } else {
                self.texture =
                    Some(ctx.load_texture("density-heatmap", image, egui::TextureOptions::LINEAR));
            }
            self.dirty = false;
        }
        egui::Window::new(shell.tr("heatmap.title", &[]))
            .id(egui::Id::new("density-heatmap"))
            .open(&mut self.open)
            .default_size(egui::vec2(700., 500.))
            .show(ctx, |ui| {
                ui.label(shell.tr("heatmap.legend", &[]));
                if let Some(texture) = &self.texture {
                    ui.add(egui::Image::new(texture).shrink_to_fit());
                }
            });
    }
}
