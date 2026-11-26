//! Building editor: validated previews are separate from the saved document.
mod image_paint;
mod ui;

use ca_core::{
    buildings::{Building, BuildingEdit, BuildingError, rotate},
    map_json::MapDocument,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Rectangle,
    Polygon,
    Image,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handle {
    Move,
    Corner(usize),
    Rotate,
    Vertex(usize),
}

struct Drag {
    index: Option<usize>,
    original: Building,
    start: [f64; 2],
    handle: Handle,
    last_input: Option<([f64; 2], bool)>,
}

#[derive(Default)]
pub struct BuildingEditor {
    parking: crate::parking::ParkingOverlays,
    parking_revision: Option<(u64, [f32; 2])>,
    render_dirty: bool,
    selected: Option<usize>,
    tool: Option<Tool>,
    vertices: Vec<[f64; 2]>,
    drag: Option<Drag>,
    preview: Option<Building>,
    error: Option<BuildingError>,
    delete_target: Option<usize>,
    delete_answer: Option<crossbeam_channel::Receiver<bool>>,
    form: Option<Building>,
    square: bool,
    image_job: Option<(
        crossbeam_channel::Receiver<crate::building_images::ImageResult>,
        Option<usize>,
    )>,
    image_draft: Option<Building>,
    images: image_paint::ImageCache,
}

impl BuildingEditor {
    pub fn set_parking_occupancy(&mut self, building: usize, occupied: usize) {
        self.parking.set_occupancy(building, occupied);
    }

    pub fn parking_building_deleted(&mut self, building: usize) {
        self.parking.delete_building(building);
    }

    pub fn reset_parking_occupancy(&mut self) {
        self.parking.reset_occupancy();
    }

    pub fn sync_parking(&mut self, document: &MapDocument, revision: u64, shift: [f32; 2]) {
        if self.parking_revision != Some((revision, shift)) {
            self.parking.refresh(document, shift);
            self.parking_revision = Some((revision, shift));
        }
    }
    pub fn selected(&self) -> Option<usize> {
        self.selected
    }

    pub fn select(&mut self, index: Option<usize>) {
        if self.selected != index
            && self
                .image_job
                .as_ref()
                .is_some_and(|(_, target)| target.is_some())
        {
            self.image_job = None;
        }
        self.selected = index;
    }

    pub fn active(&self) -> bool {
        self.tool.is_some() || self.drag.is_some() || self.image_job.is_some()
    }

    pub fn dragging(&self) -> bool {
        self.drag.is_some()
    }

    pub fn cancel(&mut self) {
        self.render_dirty |= self.preview.is_some();
        self.form = None;
        self.tool = None;
        self.drag = None;
        self.preview = None;
        self.vertices.clear();
        self.error = None;
        self.image_job = None;
        self.image_draft = None;
    }

    pub fn start(&mut self, tool: Tool) {
        self.cancel();
        self.selected = None;
        self.form = None;
        self.tool = Some(tool);
    }

    pub fn begin_image_load(
        &mut self,
        receiver: crossbeam_channel::Receiver<crate::building_images::ImageResult>,
        target: Option<usize>,
    ) {
        self.cancel();
        self.image_job = Some((receiver, target));
    }

    pub fn poll_image(&mut self, document: &MapDocument) -> Option<BuildingEdit> {
        let (receiver, target) = self.image_job.as_ref()?;
        let result = match receiver.try_recv() {
            Ok(result) => result,
            Err(crossbeam_channel::TryRecvError::Empty) => return None,
            Err(_) => Err(BuildingError("imageDecode")),
        };
        let target = *target;
        self.image_job = None;
        match result {
            Ok(Some(image)) => {
                let mut building = match target {
                    Some(index) => document.buildings().get(index)?.clone(),
                    None => Building::rectangle([0.; 2], [1.; 2]),
                };
                if let Err(error) = building.replace_image(image.data, image.pixels) {
                    self.error = Some(error);
                    return None;
                }
                if let Some(index) = target {
                    return Some(BuildingEdit::Update(index, building));
                }
                self.selected = None;
                self.tool = Some(Tool::Image);
                self.image_draft = Some(building);
            }
            Ok(None) => {}
            Err(error) => self.error = Some(error),
        }
        None
    }

    pub fn place_image(&mut self, center: [f64; 2]) -> Option<BuildingEdit> {
        let mut building = self.image_draft.take()?;
        building.center = center;
        self.tool = None;
        Some(BuildingEdit::Create(building))
    }

    pub fn open_form(&mut self) {
        self.cancel();
        self.selected = None;
        self.form = Some(Building::rectangle([0., 0.], [100., 100.]));
    }

    pub fn error(&self) -> Option<BuildingError> {
        self.error
    }

    pub fn rectangle_start(&mut self, point: [f64; 2]) {
        self.drag = Some(Drag {
            index: None,
            original: Building::rectangle(point, [0.; 2]),
            start: point,
            handle: Handle::Corner(2),
            last_input: None,
        });
    }

    pub fn begin_drag(
        &mut self,
        document: &MapDocument,
        index: usize,
        handle: Handle,
        start: [f64; 2],
    ) {
        self.selected = Some(index);
        self.error = None;
        self.preview = None;
        self.drag = Some(Drag {
            index: Some(index),
            original: document.buildings()[index].clone(),
            start,
            handle,
            last_input: None,
        });
    }

    /// Input changes only the preview. Rejected input cannot change saved geometry.
    pub fn drag_to(&mut self, point: [f64; 2], square: bool) {
        let Some(drag) = &mut self.drag else { return };
        let square = square || self.square;
        if drag.last_input == Some((point, square)) {
            return;
        }
        drag.last_input = Some((point, square));
        let original = &drag.original;
        let mut next = original.clone();
        if drag.index.is_none() {
            let mut delta: [f64; 2] = std::array::from_fn(|i| point[i] - drag.start[i]);
            if square || self.square {
                let size = delta[0].abs().max(delta[1].abs());
                delta = delta.map(|n| if n < 0. { -size } else { size });
            }
            next.center = std::array::from_fn(|i| drag.start[i] + delta[i] / 2.);
            next.size = delta.map(f64::abs);
        } else {
            match drag.handle {
                Handle::Move => {
                    next = original.moved(std::array::from_fn(|i| point[i] - drag.start[i]))
                }
                Handle::Rotate => {
                    let angle = |p: [f64; 2]| {
                        (p[1] - original.center[1])
                            .atan2(p[0] - original.center[0])
                            .to_degrees()
                    };
                    let sign = if original.legacy_image_rotation() {
                        -1.
                    } else {
                        1.
                    };
                    next = original
                        .rotated(original.angle + sign * (angle(point) - angle(drag.start)));
                }
                Handle::Vertex(index) => match original.vertex_moved(index, point) {
                    Ok(building) => next = building,
                    Err(error) => {
                        self.error = Some(error);
                        return;
                    }
                },
                Handle::Corner(index) => match original.resized_corner(index, point, square) {
                    Ok(building) => next = building,
                    Err(error) => {
                        self.error = Some(error);
                        return;
                    }
                },
            }
        }
        self.error = next.validate().err();
        if self.error.is_none() {
            self.preview = Some(next);
            self.render_dirty = true;
        }
    }

    pub fn finish_drag(&mut self) -> Option<BuildingEdit> {
        let drag = self.drag.take()?;
        let preview = self.preview.take();
        self.render_dirty = true;
        if self.error.is_some() {
            return None;
        }
        let building = preview?;
        Some(match drag.index {
            Some(index) => BuildingEdit::Update(index, building),
            None => {
                self.tool = None;
                BuildingEdit::Create(building)
            }
        })
    }

    pub fn push_vertex(&mut self, point: [f64; 2]) {
        self.vertices.push(point);
        self.error = None;
    }

    pub fn finish_polygon(&mut self) -> Option<BuildingEdit> {
        match Building::polygon(self.vertices.clone()) {
            Ok(building) => {
                self.cancel();
                Some(BuildingEdit::Create(building))
            }
            Err(error) => {
                self.error = Some(error);
                None
            }
        }
    }

    pub fn request_delete(&mut self) {
        self.delete_target = self.selected;
    }

    pub fn answer_delete(&mut self, accepted: bool) -> Option<BuildingEdit> {
        let index = self.delete_target.take()?;
        accepted.then_some(BuildingEdit::Delete(index))
    }

    pub fn refresh_render(&mut self) {
        self.render_dirty = true;
    }

    /// Geometry snapshots are coalesced independently of ordered simulation edits.
    pub fn render_update(
        &mut self,
        document: &MapDocument,
    ) -> Option<Vec<ca_core::map_json::BackgroundZone>> {
        if !std::mem::take(&mut self.render_dirty) {
            return None;
        }
        let mut zones: Vec<_> = document
            .buildings()
            .iter()
            .enumerate()
            .map(|(i, saved)| {
                ca_gpu::building_zone(if self.selected == Some(i) {
                    self.preview.as_ref().unwrap_or(saved)
                } else {
                    saved
                })
            })
            .collect();
        if self.drag.as_ref().is_some_and(|d| d.index.is_none())
            && let Some(preview) = &self.preview
        {
            zones.push(ca_gpu::building_zone(preview));
        }
        Some(zones)
    }
}
