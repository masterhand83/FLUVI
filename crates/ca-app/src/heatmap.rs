//! Shared CPU image renderer. Export never touches window state or textures.
use crate::shell::Shell;
pub use ca_core::heatmap::Snapshot as HeatmapFrame;
use eframe::egui;

const BACKGROUND: egui::Color32 = egui::Color32::from_rgb(18, 22, 28);

/// Fit all oriented physical cells inside the requested bounds, with a small margin.
/// Each axis is capped at 4096 pixels to bound image allocation. Zero gives an empty image.
pub fn render_offscreen(frame: &HeatmapFrame, maximum: [usize; 2]) -> egui::ColorImage {
    render(frame, maximum, BACKGROUND)
}

/// Print/export variant. Cell colors and geometry are identical to the live view.
pub fn render_on_white(frame: &HeatmapFrame, maximum: [usize; 2]) -> egui::ColorImage {
    render(frame, maximum, egui::Color32::WHITE)
}

fn render(
    frame: &HeatmapFrame,
    maximum: [usize; 2],
    background: egui::Color32,
) -> egui::ColorImage {
    if maximum.contains(&0) {
        return egui::ColorImage::filled([0, 0], background);
    }
    let maximum = maximum.map(|v| v.min(4096));
    let mut minimum = [f32::INFINITY; 2];
    let mut upper = [f32::NEG_INFINITY; 2];
    for tile in &frame.tiles {
        let radius = (tile.axis[0].abs() + tile.axis[1].abs()) * 0.5;
        for i in 0..2 {
            minimum[i] = minimum[i].min(tile.center[i] - radius - 0.5);
            upper[i] = upper[i].max(tile.center[i] + radius + 0.5);
        }
    }
    if frame.tiles.is_empty() {
        return egui::ColorImage::filled([1, 1], background);
    }
    let span: [f32; 2] = std::array::from_fn(|i| upper[i] - minimum[i]);
    let scale = (maximum[0] as f32 / span[0]).min(maximum[1] as f32 / span[1]);
    let size = std::array::from_fn(|i| ((span[i] * scale).ceil() as usize).clamp(1, maximum[i]));
    let mut image = egui::ColorImage::filled(size, background);
    for tile in &frame.tiles {
        let center: [f32; 2] = std::array::from_fn(|i| (tile.center[i] - minimum[i]) * scale);
        let radius = (tile.axis[0].abs() + tile.axis[1].abs()) * scale * 0.5;
        let start: [usize; 2] = center.map(|v| (v - radius).max(0.).floor() as usize);
        let end: [usize; 2] =
            std::array::from_fn(|i| ((center[i] + radius).ceil() as usize).min(size[i]));
        let color = if let Some(density) = tile.density {
            // Green → yellow → red. Grey obstructions never acquire a heat value.
            let d = density as f32;
            egui::Color32::from_rgb(
                (255. * (2. * d).min(1.)) as u8,
                (220. * (2. - 2. * d).min(1.)) as u8,
                40,
            )
        } else if tile.obstacle {
            egui::Color32::from_gray(145)
        } else {
            egui::Color32::from_gray(55)
        };
        for y in start[1]..end[1] {
            for x in start[0]..end[0] {
                let dx = (x as f32 + 0.5 - center[0]) / scale;
                let dy = (y as f32 + 0.5 - center[1]) / scale;
                if (dx * tile.axis[0] + dy * tile.axis[1]).abs() <= 0.5
                    && (-dx * tile.axis[1] + dy * tile.axis[0]).abs() <= 0.5
                {
                    image.pixels[y * size[0] + x] = color;
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
        render_offscreen(&self.frame, maximum)
    }

    pub fn show(&mut self, ctx: &egui::Context, shell: &Shell) {
        if !self.open {
            return;
        }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            self.open = false;
            return;
        }
        if self.dirty || self.texture.is_none() {
            let image = self.render_offscreen([960, 640]);
            if let Some(texture) = &mut self.texture {
                texture.set(image, egui::TextureOptions::NEAREST);
            } else {
                self.texture =
                    Some(ctx.load_texture("density-heatmap", image, egui::TextureOptions::NEAREST));
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
