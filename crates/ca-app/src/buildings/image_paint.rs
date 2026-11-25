use crate::building_images::{self, ImageResult, Source};
use ca_core::buildings::{Building, artwork};
use eframe::egui;
use std::collections::HashMap;

#[derive(Default)]
pub(super) struct ImageCache {
    textures: HashMap<String, Option<egui::TextureHandle>>,
    job: Option<(String, crossbeam_channel::Receiver<ImageResult>)>,
}

impl ImageCache {
    pub(super) fn retain(
        &mut self,
        document: &ca_core::map_json::MapDocument,
        draft: Option<&Building>,
    ) {
        let used = |key: &str| {
            document.buildings().iter().chain(draft).any(|building| {
                building.image_data() == Some(key)
                    || building.image_key().and_then(artwork::path) == Some(key)
            })
        };
        self.textures.retain(|key, _| used(key));
        if self.job.as_ref().is_some_and(|(key, _)| !used(key)) {
            self.job = None;
        }
    }

    pub(super) fn paint(
        &mut self,
        painter: &egui::Painter,
        building: &Building,
        corners: [egui::Pos2; 4],
    ) {
        if let Some((key, receiver)) = &self.job
            && let Ok(result) = receiver.try_recv()
        {
            let texture = result.ok().flatten().map(|decoded| {
                painter.ctx().load_texture(
                    "building-image",
                    egui::ColorImage::from_rgba_unmultiplied(
                        decoded.pixels.map(|n| n as usize),
                        &decoded.rgba,
                    ),
                    egui::TextureOptions::LINEAR,
                )
            });
            self.textures.insert(key.clone(), texture);
            self.job = None;
        }
        let (key, source) = if let Some(data) = building.image_data() {
            (data, None)
        } else if let Some(path) = building.image_key().and_then(artwork::path) {
            (path, Some(path))
        } else {
            return;
        };
        if !self.textures.contains_key(key) && self.job.is_none() {
            let source = source
                .map(Source::Bundled)
                .unwrap_or_else(|| Source::Data(key.into()));
            match building_images::start(source, painter.ctx().clone()) {
                Ok(receiver) => self.job = Some((key.into(), receiver)),
                Err(_) => {
                    self.textures.insert(key.into(), None);
                }
            }
        }
        if let Some(Some(texture)) = self.textures.get(key) {
            let mut mesh = egui::Mesh::with_texture(texture.id());
            for (pos, uv) in corners.into_iter().zip([
                egui::pos2(0., 0.),
                egui::pos2(1., 0.),
                egui::pos2(1., 1.),
                egui::pos2(0., 1.),
            ]) {
                mesh.vertices.push(egui::epaint::Vertex {
                    pos,
                    uv,
                    color: egui::Color32::WHITE,
                });
            }
            mesh.add_triangle(0, 1, 2);
            mesh.add_triangle(0, 2, 3);
            painter.add(mesh);
        }
    }
}
