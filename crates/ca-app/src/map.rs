//! Map input adapter. All picks and drawing use the same local-screen camera.
use ca_core::{
    camera::{Camera, WorldView},
    cell_index::{CellIndex, CellRef, StreetGeometry},
};
use eframe::egui;

pub struct MapFrame {
    pub rect: egui::Rect,
    pub view: WorldView,
    pub clicked: Option<CellRef>,
    pub tooltip: Option<String>,
}

pub struct MapInteraction {
    extent: [f32; 2],
    camera: Option<Camera>,
    index: CellIndex,
    names: Vec<String>,
    touch_gesture: bool,
}

impl MapInteraction {
    pub fn new(extent: [f32; 2], streets: &[StreetGeometry], names: Vec<String>) -> Self {
        let mut index = CellIndex::new(1.0);
        index.sync(streets);
        Self {
            extent,
            camera: None,
            index,
            names,
            touch_gesture: false,
        }
    }

    pub fn camera(&self) -> Option<&Camera> {
        self.camera.as_ref()
    }

    /// Geometry owners use this only on edits, not on simulation ticks.
    pub fn sync_geometry(&mut self, streets: &[StreetGeometry], names: Vec<String>) {
        self.index.sync(streets);
        self.names = names;
    }

    pub fn show(&mut self, ui: &mut egui::Ui, detect: bool) -> MapFrame {
        let rect = ui.available_rect_before_wrap();
        let response = ui.allocate_rect(rect, egui::Sense::click_and_drag());
        let viewport = [rect.width().max(1.0), rect.height().max(1.0)];
        let camera = self
            .camera
            .get_or_insert_with(|| Camera::fit(self.extent, viewport));
        camera.resize(viewport);
        // Response::drag_delta reads the context; do not call it under input's lock.
        let drag_delta = response.drag_delta();
        ui.input(|input| {
            if let Some(touch) = input.multi_touch() {
                if rect.contains(touch.start_pos)
                    && (response.contains_pointer() || response.dragged())
                {
                    self.touch_gesture = true;
                    let anchor = touch.center_pos - touch.translation_delta - rect.min;
                    camera.zoom_at(anchor.into(), touch.zoom_delta);
                    camera.pan(touch.translation_delta.into());
                }
            } else if response.dragged() && !self.touch_gesture {
                camera.pan(drag_delta.into());
            }
            if response.hovered()
                && let Some(pos) = input.pointer.hover_pos()
            {
                let anchor = (pos - rect.min).into();
                for event in &input.events {
                    match event {
                        egui::Event::MouseWheel {
                            unit,
                            delta,
                            modifiers,
                        } => {
                            match unit {
                                // Discrete mouse wheels zoom; pixel trackpads pan.
                                egui::MouseWheelUnit::Line => {
                                    camera.zoom_at(anchor, (delta.y * 0.15).exp())
                                }
                                _ if modifiers.ctrl || modifiers.command => {
                                    camera.zoom_at(anchor, (delta.y * 0.01).exp())
                                }
                                egui::MouseWheelUnit::Point => camera.pan(delta.into()),
                                egui::MouseWheelUnit::Page => {
                                    camera.pan([delta.x * viewport[0], delta.y * viewport[1]])
                                }
                            }
                        }
                        egui::Event::Zoom(factor) if input.multi_touch().is_none() => {
                            camera.zoom_at(anchor, *factor)
                        }
                        _ => {}
                    }
                }
            }
        });
        let hit = response
            .hover_pos()
            .filter(|_| !response.dragged() && !self.touch_gesture)
            .and_then(|pos| {
                self.index
                    .hit_test(camera.screen_to_world((pos - rect.min).into()))
            });
        let clicked = response.clicked().then_some(hit).flatten();
        let tooltip = hit.filter(|_| detect).and_then(|cell| {
            self.names
                .get(cell.street)
                .map(|name| format!("{name} : {}", cell.index))
        });
        if let Some(text) = &tooltip {
            response.on_hover_text_at_pointer(text);
        }
        if !ui.input(|i| i.pointer.any_down()) {
            self.touch_gesture = false;
        }
        MapFrame {
            rect,
            view: camera.view(),
            clicked,
            tooltip,
        }
    }
}
