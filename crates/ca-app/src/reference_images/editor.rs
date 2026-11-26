use super::{
    Gesture, Handle, LoadResult, Source,
    gesture::{center, corners, number},
    start,
};
use ca_core::{camera::WorldView, map_json::MapDocument};
use crossbeam_channel::{Receiver, TryRecvError};
use egui::{self, Color32, Pos2, Rect};
use serde_json::{Value, json};
use std::sync::Arc;

#[derive(PartialEq)]
struct MeshKey {
    corners: [Pos2; 4],
    opacity: u8,
    texture: egui::TextureId,
}

#[derive(Default)]
pub struct Editor {
    opened: bool,
    selected: bool,
    url: String,
    source: Option<(bool, String)>,
    job: Option<Receiver<LoadResult>>,
    upload: Option<Receiver<LoadResult>>,
    texture: Option<egui::TextureHandle>,
    unavailable: bool,
    error: Option<&'static str>,
    gesture: Option<Gesture>,
    last_pointer: Option<[f64; 2]>,
    preview: Option<Value>,
    pending: Option<Option<Value>>,
    mesh: Option<(MeshKey, Arc<egui::Mesh>)>,
    fit_link: Option<(String, [f64; 2])>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Status {
    Empty,
    Loading,
    Ready,
    Unavailable,
}

fn screen(p: [f64; 2], rect: Rect, view: WorldView, shift: [f32; 2]) -> Pos2 {
    rect.min
        + egui::vec2(
            (p[0] as f32 / 5. + shift[0] - view.origin[0]) / view.span[0] * rect.width(),
            (p[1] as f32 / 5. + shift[1] - view.origin[1]) / view.span[1] * rect.height(),
        )
}

fn world(p: Pos2, rect: Rect, view: WorldView, shift: [f32; 2]) -> [f64; 2] {
    let fraction = [
        (p.x - rect.min.x) / rect.width(),
        (p.y - rect.min.y) / rect.height(),
    ];
    std::array::from_fn(|i| {
        (view.origin[i] as f64 + fraction[i] as f64 * view.span[i] as f64 - shift[i] as f64) * 5.
    })
}

fn initial(view: WorldView, shift: [f32; 2]) -> Value {
    json!({
        "x":(view.origin[0] + view.span[0]/2. - shift[0]) as f64 * 5. - 80.,
        "y":(view.origin[1] + view.span[1]/2. - shift[1]) as f64 * 5. - 45.,
        "width":160.,"height":90.,"rotation":0.,"visible":true,"locked":false,"opacity":0.7
    })
}

fn fit(image: &mut Value, pixels: [u32; 2], bounds: [f64; 2]) {
    let c = center(image);
    let scale = (bounds[0] / pixels[0] as f64).min(bounds[1] / pixels[1] as f64);
    let width = pixels[0] as f64 * scale;
    let height = pixels[1] as f64 * scale;
    image["x"] = (c[0] - width / 2.).into();
    image["y"] = (c[1] - height / 2.).into();
    image["width"] = width.into();
    image["height"] = height.into();
}

impl Editor {
    pub fn status(&self) -> Status {
        if self.job.is_some() || self.upload.is_some() {
            Status::Loading
        } else if self.unavailable {
            Status::Unavailable
        } else if self.texture.is_some() {
            Status::Ready
        } else {
            Status::Empty
        }
    }

    pub fn open(&mut self) {
        self.opened = true;
        self.selected = true;
    }

    /// Publish a link before its worker runs so failure cannot discard placement.
    pub fn link(
        &mut self,
        url: &str,
        document: &MapDocument,
        view: WorldView,
        shift: [f32; 2],
    ) -> Result<(), &'static str> {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err("reference.invalidUrl");
        }
        self.cancel_gesture();
        self.error = None;
        self.upload = None;
        self.fit_link = if let Some(image) = document.reference_image_json() {
            (self.texture.is_some() && !self.unavailable).then(|| {
                (
                    url.into(),
                    [number(image, "width"), number(image, "height")],
                )
            })
        } else {
            Some((url.into(), view.span.map(|n| n as f64 * 4.)))
        };
        let mut image = document
            .reference_image_json()
            .cloned()
            .unwrap_or_else(|| initial(view, shift));
        image
            .as_object_mut()
            .expect("reference object")
            .remove("dataUrl");
        image["url"] = url.into();
        self.pending = Some(Some(image));
        self.source = None;
        Ok(())
    }

    fn image<'a>(&'a self, document: &'a MapDocument) -> Option<&'a Value> {
        self.preview
            .as_ref()
            .or_else(|| document.reference_image_json())
    }

    pub fn pending(&self) -> Option<&Option<Value>> {
        self.pending.as_ref()
    }

    pub fn committed(&mut self) {
        self.pending = None;
        self.preview = None;
    }

    pub fn cancel_gesture(&mut self) {
        self.gesture = None;
        self.last_pointer = None;
        if self.pending.is_none() {
            self.preview = None;
        }
    }

    /// Poll bounded workers without waiting; source changes drop stale receivers.
    pub fn update(
        &mut self,
        ctx: &egui::Context,
        document: &MapDocument,
        view: WorldView,
        shift: [f32; 2],
    ) {
        if let Some(upload) = &self.upload {
            match upload.try_recv() {
                Ok(Ok(Some(loaded))) => {
                    let mut image = document.reference_image_json().cloned().unwrap_or_else(|| {
                        let mut image = initial(view, shift);
                        fit(
                            &mut image,
                            loaded.image.pixels,
                            view.span.map(|n| n as f64 * 4.),
                        );
                        image
                    });
                    if document.reference_image_json().is_some()
                        && self.texture.is_some()
                        && !self.unavailable
                    {
                        let bounds = [number(&image, "width"), number(&image, "height")];
                        fit(&mut image, loaded.image.pixels, bounds);
                    }
                    image
                        .as_object_mut()
                        .expect("reference object")
                        .remove("url");
                    image["dataUrl"] = loaded.data_url.expect("file data URL").into();
                    self.pending = Some(Some(image));
                    self.upload = None;
                    self.selected = true;
                }
                Ok(Ok(None)) => self.upload = None,
                Ok(Err(_)) | Err(TryRecvError::Disconnected) => {
                    self.upload = None;
                    self.error = Some("reference.loadFailed");
                }
                Err(TryRecvError::Empty) => {}
            }
        }
        let source = document.reference_image().and_then(|image| {
            image
                .data_url
                .map(|s| (true, s))
                .or_else(|| image.url.map(|s| (false, s)))
        });
        if self.source.as_ref().map(|(data, s)| (*data, s.as_str())) != source {
            self.job = None;
            self.texture = None;
            self.mesh = None;
            self.unavailable = false;
            self.source = source.map(|(data, s)| (data, s.into()));
            self.selected = source.is_some();
            if let Some((data, source)) = &self.source {
                let source = if *data {
                    Source::Data(source.clone())
                } else {
                    Source::Url(source.clone())
                };
                match start(source, ctx.clone()) {
                    Ok(job) => self.job = Some(job),
                    Err(_) => self.unavailable = true,
                }
            }
        }
        if let Some(job) = &self.job {
            match job.try_recv() {
                Ok(Ok(Some(loaded))) => {
                    if let Some((url, bounds)) = self.fit_link.take()
                        && document
                            .reference_image_json()
                            .is_some_and(|image| image["url"] == url)
                    {
                        let mut image = document
                            .reference_image_json()
                            .expect("linked image")
                            .clone();
                        fit(&mut image, loaded.image.pixels, bounds);
                        self.pending = Some(Some(image));
                    }
                    self.texture = Some(ctx.load_texture(
                        "reference-image",
                        egui::ColorImage::from_rgba_unmultiplied(
                            loaded.image.pixels.map(|n| n as usize),
                            &loaded.image.rgba,
                        ),
                        egui::TextureOptions::LINEAR,
                    ));
                    self.job = None;
                }
                Ok(_) | Err(TryRecvError::Disconnected) => {
                    self.job = None;
                    self.unavailable = true;
                }
                Err(TryRecvError::Empty) => {}
            }
        }
    }

    pub fn show(
        &mut self,
        ctx: &egui::Context,
        shell: &crate::shell::Shell,
        document: &MapDocument,
        view: WorldView,
        shift: [f32; 2],
    ) {
        if !self.opened {
            return;
        }
        let mut opened = self.opened;
        egui::Window::new(shell.tr("reference.title", &[]))
            .open(&mut opened)
            .default_width(300.)
            .show(ctx, |ui| {
                if ui
                    .add_enabled(
                        self.upload.is_none(),
                        egui::Button::new(shell.tr("reference.file", &[])),
                    )
                    .clicked()
                {
                    self.cancel_gesture();
                    self.fit_link = None;
                    self.error = None;
                    match start(
                        Source::FileDialog(shell.tr("reference.file", &[])),
                        ctx.clone(),
                    ) {
                        Ok(job) => self.upload = Some(job),
                        Err(_) => self.error = Some("reference.loadFailed"),
                    }
                }
                ui.label(shell.tr("reference.url", &[]));
                ui.text_edit_singleline(&mut self.url);
                if ui.button(shell.tr("reference.link", &[])).clicked() {
                    self.cancel_gesture();
                    let url = self.url.trim().to_owned();
                    if let Err(key) = self.link(&url, document, view, shift) {
                        self.error = Some(key);
                    }
                }
                if let Some(image) = document.reference_image_json() {
                    let mut locked = image["locked"] == true;
                    let mut visible = image["visible"] != false;
                    let mut opacity = image["opacity"].as_f64().unwrap_or(1.);
                    let mut edit = ui
                        .checkbox(&mut locked, shell.tr("reference.locked", &[]))
                        .changed();
                    edit |= ui
                        .checkbox(&mut visible, shell.tr("reference.visible", &[]))
                        .changed();
                    edit |= ui
                        .add(
                            egui::Slider::new(&mut opacity, 0. ..=1.)
                                .text(shell.tr("reference.opacity", &[])),
                        )
                        .changed();
                    if edit {
                        let mut changed = image.clone();
                        self.cancel_gesture();
                        changed["locked"] = locked.into();
                        changed["visible"] = visible.into();
                        changed["opacity"] = opacity.into();
                        self.pending = Some(Some(changed));
                    }
                    if ui.button(shell.tr("reference.remove", &[])).clicked() {
                        self.cancel_gesture();
                        self.upload = None;
                        self.pending = Some(None);
                    }
                }
                if self.job.is_some() || self.upload.is_some() {
                    ui.spinner();
                }
                if self.unavailable {
                    ui.label(shell.tr("reference.unavailable", &[]));
                }
                if let Some(key) = self.error {
                    ui.label(shell.tr(key, &[]));
                }
            });
        self.opened = opened;
    }

    fn pick(
        &self,
        document: &MapDocument,
        pos: Pos2,
        rect: Rect,
        view: WorldView,
        shift: [f32; 2],
    ) -> Option<Handle> {
        if !self.selected || self.texture.is_none() {
            return None;
        }
        let image = self.image(document)?;
        if image["locked"] == true || image["visible"] == false {
            return None;
        }
        let points = corners(image).map(|p| screen(p, rect, view, shift));
        if let Some(i) = points.iter().position(|p| p.distance(pos) <= 9.) {
            return Some(Handle::Corner(i));
        }
        if self.rotation_handle(image, rect, view, shift).distance(pos) <= 9. {
            return Some(Handle::Rotate);
        }
        let p = ca_core::buildings::rotate(
            world(pos, rect, view, shift),
            center(image),
            -number(image, "rotation"),
        );
        (p[0] >= number(image, "x")
            && p[0] <= number(image, "x") + number(image, "width")
            && p[1] >= number(image, "y")
            && p[1] <= number(image, "y") + number(image, "height"))
        .then_some(Handle::Move)
    }

    fn rotation_handle(&self, image: &Value, rect: Rect, view: WorldView, shift: [f32; 2]) -> Pos2 {
        let points = corners(image).map(|p| screen(p, rect, view, shift));
        let top = points[0].lerp(points[1], 0.5);
        let c = screen(center(image), rect, view, shift);
        top + (top - c).normalized() * 24.
    }

    pub fn captures(
        &self,
        ctx: &egui::Context,
        document: &MapDocument,
        rect: Rect,
        view: WorldView,
        shift: [f32; 2],
    ) -> bool {
        if self.gesture.is_some() {
            return true;
        }
        ctx.input(|i| {
            !i.modifiers.shift
                && !i.modifiers.ctrl
                && i.pointer.primary_pressed()
                && i.pointer
                    .interact_pos()
                    .filter(|p| rect.contains(*p))
                    .is_some_and(|p| self.pick(document, p, rect, view, shift).is_some())
        })
    }

    pub fn input(
        &mut self,
        ui: &egui::Ui,
        document: &MapDocument,
        rect: Rect,
        view: WorldView,
        shift: [f32; 2],
        enabled: bool,
    ) {
        if !enabled || ui.input(|i| !i.focused || i.key_pressed(egui::Key::Escape)) {
            self.cancel_gesture();
            return;
        }
        let pointer = ui.input(|i| i.pointer.clone());
        if self.gesture.is_some() && !pointer.primary_down() && !pointer.primary_released() {
            self.cancel_gesture();
        }
        let Some(pos) = pointer.interact_pos() else {
            return;
        };
        let point = world(pos, rect, view, shift);
        if self.gesture.is_none()
            && pointer.primary_pressed()
            && ui.rect_contains_pointer(rect)
            && !ui.input(|i| i.modifiers.shift || i.modifiers.ctrl)
            && let Some(handle) = self.pick(document, pos, rect, view, shift)
            && let Some(image) = self.image(document)
        {
            self.gesture = Gesture::begin(image, handle, point);
            self.last_pointer = None;
        }
        if let Some(gesture) = &self.gesture {
            if self.last_pointer != Some(point) {
                self.preview = Some(gesture.update(point));
                self.last_pointer = Some(point);
            }
            if pointer.primary_released() {
                if let (Some(saved), Some(preview)) =
                    (document.reference_image_json(), &self.preview)
                {
                    let mut image = saved.clone();
                    for key in ["x", "y", "width", "height", "rotation"] {
                        image[key] = preview[key].clone();
                    }
                    self.pending = Some(Some(image));
                }
                self.gesture = None;
            }
        }
    }

    pub fn paint(
        &mut self,
        painter: &egui::Painter,
        document: &MapDocument,
        rect: Rect,
        view: WorldView,
        shift: [f32; 2],
    ) {
        let Some(image) = self.image(document).filter(|i| i["visible"] != false) else {
            return;
        };
        let painter = painter.with_clip_rect(rect);
        if let Some(texture) = &self.texture {
            let opacity = image["opacity"].as_f64().unwrap_or(1.).clamp(0., 1.);
            let key = MeshKey {
                corners: corners(image).map(|p| screen(p, rect, view, shift)),
                opacity: (opacity * 255.).round() as u8,
                texture: texture.id(),
            };
            if self.mesh.as_ref().is_none_or(|(cached, _)| cached != &key) {
                let mut mesh = egui::Mesh::with_texture(key.texture);
                for (pos, uv) in key.corners.into_iter().zip([
                    egui::pos2(0., 0.),
                    egui::pos2(1., 0.),
                    egui::pos2(1., 1.),
                    egui::pos2(0., 1.),
                ]) {
                    mesh.vertices.push(egui::epaint::Vertex {
                        pos,
                        uv,
                        color: Color32::from_white_alpha(key.opacity),
                    });
                }
                mesh.add_triangle(0, 1, 2);
                mesh.add_triangle(0, 2, 3);
                self.mesh = Some((key, Arc::new(mesh)));
            }
            if let Some((_, mesh)) = &self.mesh {
                painter.add(egui::Shape::Mesh(Arc::clone(mesh)));
            }
        }
    }

    pub fn paint_controls(
        &self,
        painter: &egui::Painter,
        shell: &crate::shell::Shell,
        document: &MapDocument,
        rect: Rect,
        view: WorldView,
        shift: [f32; 2],
    ) {
        let Some(image) = self.image(document).filter(|i| i["visible"] != false) else {
            return;
        };
        let painter = painter.with_clip_rect(rect);
        if self.unavailable {
            painter.text(
                screen(center(image), rect, view, shift),
                egui::Align2::CENTER_CENTER,
                shell.tr("reference.unavailable", &[]),
                egui::FontId::proportional(16.),
                Color32::LIGHT_RED,
            );
        }
        if !self.selected || image["locked"] == true || self.texture.is_none() {
            return;
        }
        let points = corners(image).map(|p| screen(p, rect, view, shift));
        for i in 0..4 {
            painter.line_segment(
                [points[i], points[(i + 1) % 4]],
                egui::Stroke::new(1_f32, Color32::YELLOW),
            );
            painter.circle_filled(points[i], 5., Color32::YELLOW);
        }
        let handle = self.rotation_handle(image, rect, view, shift);
        painter.line_segment(
            [points[0].lerp(points[1], 0.5), handle],
            egui::Stroke::new(1_f32, Color32::GREEN),
        );
        painter.circle_filled(handle, 5., Color32::GREEN);
    }
}
