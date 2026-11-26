//! CPU traffic state packed once per completed batch for direct GPU display.
use bytemuck::{Pod, Zeroable};
use ca_core::camera::WorldView;
use ca_core::cell_index::{CellRef, StreetGeometry};
use ca_core::traffic::{CalleType, LaneDirection, TrafficError, VehicleAction};
use wgpu::util::DeviceExt;

use crate::{ViewUniform, entry};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum VehicleStyle {
    #[default]
    Classes,
    Heat,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct HeatLane {
    offset: u32,
    length: u32,
    periodic: u32,
    padding: u32,
}
const _: () = {
    assert!(size_of::<HeatLane>() == 16);
    assert!(std::mem::offset_of!(HeatLane, offset) == 0);
    assert!(std::mem::offset_of!(HeatLane, length) == 4);
    assert!(std::mem::offset_of!(HeatLane, periodic) == 8);
    assert!(std::mem::offset_of!(HeatLane, padding) == 12);
};

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct TrafficLane {
    pub origin: [f32; 2],
    pub offset: u32,
    pub length: u32,
    /// 1 means physical indices increase in the travel direction; 0 reverses it.
    pub direction: u32,
    pub street_type: u32,
    pub axis: [f32; 2],
}
const _: () = assert!(size_of::<TrafficLane>() == 32);

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
struct TrafficTile {
    center: [f32; 2],
    axis: [f32; 2],
    offset: u32,
    street_type: u32,
    direction: u32,
    /// Low bit marks an arrow. Upper bits index the static heat lane metadata.
    lane_and_arrow: u32,
}
const _: () = assert!(size_of::<TrafficTile>() == 32);
const _: () = assert!(std::mem::offset_of!(TrafficTile, lane_and_arrow) == 28);

pub struct TrafficScene {
    heatmaps: [std::sync::Arc<ca_core::heatmap::Snapshot>; 2],
    metrics: ca_core::metrics::Metrics,
    lanes: Vec<TrafficLane>,
    heat_lanes: Vec<HeatLane>,
    cells: Vec<u32>,
    edited: bool,
    names: Vec<String>,
    extent: [u32; 2],
    geometry: Vec<StreetGeometry>,
    axes: Vec<Vec<Vec<[f32; 2]>>>,
    tiles: Vec<TrafficTile>,
    shift: [f32; 2],
    placements: Vec<ca_core::map_json::StreetPlacement>,
    street_tiles: Vec<std::ops::Range<usize>>,
    street_lanes: Vec<std::ops::Range<usize>>,
    zones: Vec<ca_core::map_json::BackgroundZone>,
    document: ca_core::map_json::MapDocument,
}

impl TrafficScene {
    pub fn set_reference_image(&mut self, image: Option<serde_json::Value>) {
        self.document
            .set_reference_image(image)
            .expect("validated reference edit");
    }
    /// A capture worker takes a snapshot, never the live model or its GPU view.
    pub fn document(&self) -> &ca_core::map_json::MapDocument {
        &self.document
    }

    /// Reuse startup/topology storage. A slow UI skips a sample, never blocks or allocates.
    pub fn heatmap_snapshot(&mut self) -> Option<std::sync::Arc<ca_core::heatmap::Snapshot>> {
        for buffer in &mut self.heatmaps {
            if let Some(snapshot) = std::sync::Arc::get_mut(buffer) {
                snapshot.refresh(self.document.model().streets(), &self.geometry, &self.axes);
                return Some(std::sync::Arc::clone(buffer));
            }
        }
        None
    }

    pub fn configure_parking(
        &mut self,
        building: usize,
        config: Option<ca_core::parking::ParkingConfig>,
    ) -> Result<(), ca_core::parking::ParkingError> {
        self.document.configure_parking(building, config)
    }

    pub fn parking_occupancies(&self) -> impl Iterator<Item = (usize, usize)> + '_ {
        self.document
            .buildings()
            .iter()
            .enumerate()
            .filter_map(|(i, _)| self.document.model().parking(i).map(|p| (i, p.occupied())))
    }
    pub fn edit_buildings(&mut self, edit: ca_core::buildings::BuildingEdit) {
        self.document
            .edit_buildings(edit)
            .expect("validated ordered building edit");
    }

    pub fn building_zones(&self) -> Vec<ca_core::map_json::BackgroundZone> {
        self.document
            .buildings()
            .iter()
            .map(crate::building_zone)
            .collect()
    }
    pub fn demo() -> Self {
        Self::from_document(&ca_core::map_json::MapDocument::demo())
    }

    /// Shift only the display to positive coordinates. The document retains
    /// the map's original world positions.
    pub fn from_document(document: &ca_core::map_json::MapDocument) -> Self {
        let model = document.model();
        let snapshot = document.geometry_snapshot();
        let mut geometry = snapshot.streets;
        let axes = snapshot.axes;
        let mut lanes = Vec::new();
        let mut heat_lanes = Vec::new();
        let mut names = Vec::new();
        let mut offset = 0;
        let mut minimum = [f32::INFINITY; 2];
        let mut maximum = [f32::NEG_INFINITY; 2];
        for (id, (street, placement)) in model.streets().iter().zip(document.layout()).enumerate() {
            names.push(placement.name.clone());
            for (lane, (centers, lane_axes)) in
                geometry[id].centers.iter().zip(&axes[id]).enumerate()
            {
                let axis = lane_axes[0];
                let center = centers[0];
                let position = [
                    center[0] - axis[0] * 0.5 + axis[1] * 0.5,
                    center[1] - axis[1] * 0.5 - axis[0] * 0.5,
                ];
                for (center, axis) in centers.iter().zip(lane_axes) {
                    for i in 0..2 {
                        let radius = (axis[0].abs() + axis[1].abs()) * 0.5;
                        minimum[i] = minimum[i].min(center[i] - radius);
                        maximum[i] = maximum[i].max(center[i] + radius);
                    }
                }
                lanes.push(TrafficLane {
                    origin: position,
                    axis,
                    offset,
                    length: street.config().tamano as u32,
                    direction: u32::from(street.lane_direction(lane) == LaneDirection::Forward),
                    street_type: match street.config().tipo {
                        CalleType::Generador => 0,
                        CalleType::Conexion => 1,
                        CalleType::Devorador => 2,
                    },
                });
                heat_lanes.push(HeatLane {
                    offset,
                    length: street.config().tamano as u32,
                    periodic: u32::from(street.config().periodic),
                    padding: 0,
                });
                offset += street.config().tamano as u32;
            }
        }
        for point in document.zones().iter().flat_map(|zone| &zone.points) {
            for i in 0..2 {
                minimum[i] = minimum[i].min(point[i]);
                maximum[i] = maximum[i].max(point[i]);
            }
        }
        for building in document.buildings() {
            let bounds = building.bounds();
            for i in 0..2 {
                minimum[i] = minimum[i].min(bounds[0][i] as f32 / 5.);
                maximum[i] = maximum[i].max(bounds[1][i] as f32 / 5.);
            }
        }
        if !minimum[0].is_finite() {
            minimum = [0.0; 2];
            maximum = [1.0; 2];
        }
        let shift = minimum.map(|v| 2.0 - v);
        for lane in &mut lanes {
            for (i, min) in minimum.iter().enumerate() {
                lane.origin[i] += 2.0 - min;
            }
        }
        let mut tiles = Vec::new();
        let mut street_tiles = Vec::new();
        let mut street_lanes = Vec::new();
        let mut lane_start = 0;
        let mut lane_layouts = lanes.iter();
        for (id, street) in geometry.iter_mut().enumerate() {
            let start = tiles.len();
            for (lane, centers) in street.centers.iter_mut().enumerate() {
                let layout = lane_layouts.next().expect("lane layout");
                for (index, center) in centers.iter_mut().enumerate() {
                    for i in 0..2 {
                        center[i] += shift[i];
                    }
                    tiles.push(TrafficTile {
                        center: *center,
                        axis: axes[id][lane][index],
                        offset: layout.offset + index as u32,
                        street_type: layout.street_type,
                        direction: layout.direction,
                        lane_and_arrow: ((lane_start + lane) as u32) << 1,
                    });
                }
                if document.layout()[id].roundabout.is_some() {
                    continue;
                }
                for (index, distance) in [(0, -1.5), (centers.len() - 1, 1.5)] {
                    let axis = axes[id][lane][index];
                    tiles.push(TrafficTile {
                        center: std::array::from_fn(|i| centers[index][i] + axis[i] * distance),
                        axis,
                        offset: 0,
                        street_type: layout.street_type,
                        direction: layout.direction,
                        lane_and_arrow: (((lane_start + lane) as u32) << 1) | 1,
                    });
                }
            }
            street_tiles.push(start..tiles.len());
            street_lanes.push(lane_start..lane_start + street.centers.len());
            lane_start += street.centers.len();
        }
        let mut scene = Self {
            heatmaps: std::array::from_fn(|_| {
                std::sync::Arc::new(ca_core::heatmap::Snapshot::from_geometry(
                    model.streets(),
                    &geometry,
                    &axes,
                ))
            }),
            metrics: ca_core::metrics::Metrics::new(model.streets()),
            lanes,
            heat_lanes,
            names,
            extent: std::array::from_fn(|i| (maximum[i] - minimum[i] + 4.0).ceil() as u32),
            cells: vec![0; offset as usize],
            edited: false,
            geometry,
            axes,
            tiles,
            shift,
            placements: document.layout().to_vec(),
            street_tiles,
            street_lanes,
            zones: document.zones().to_vec(),
            document: document.clone(),
        };
        scene.pack();
        scene
    }

    fn pack(&mut self) {
        for (target, (value, mark)) in self.cells.iter_mut().zip(
            self.document
                .model()
                .streets()
                .iter()
                .flat_map(|street| street.cells().iter().zip(street.disruptions())),
        ) {
            *target = u32::from(*value)
                | if *value == 7 {
                    mark.map_or(0, |m| (m as u32) << 8)
                } else {
                    0
                };
        }
        self.edited = false;
    }

    pub fn tick(&mut self) {
        self.document.tick();
        self.metrics
            .update(self.document.model().streets(), self.document.time().clock);
        self.pack();
    }

    pub fn metrics(&self) -> &ca_core::metrics::Metrics {
        &self.metrics
    }

    pub fn set_metric_streets(&mut self, included: Vec<bool>) {
        self.metrics
            .set_included(self.document.model().streets(), included);
    }

    pub fn set_rain(&mut self, active: bool, probability: f64) -> Result<(), TrafficError> {
        self.document.model_mut().set_rain(active, probability)
    }

    pub fn capture_scenario(
        &self,
        name: &str,
        id: &str,
    ) -> Result<ca_core::scenario_json::Scenario, ca_core::scenario_json::ScenarioError> {
        self.document.capture_scenario(name, id)
    }

    pub fn load_scenario(
        &mut self,
        scenario: &ca_core::scenario_json::Scenario,
    ) -> Result<(), ca_core::scenario_json::ScenarioError> {
        self.document.load_scenario(scenario)?;
        self.edited = true;
        Ok(())
    }

    /// Apply ordered actions, then publish once at the frame boundary or next tick.
    pub fn disrupt(
        &mut self,
        action: ca_core::disruptions::ScenarioAction,
    ) -> Result<usize, TrafficError> {
        let count = self.document.model_mut().disrupt(action)?;
        self.edited |= count > 0
            || matches!(
                action,
                ca_core::disruptions::ScenarioAction::MassFlood
                    | ca_core::disruptions::ScenarioAction::RandomPotholes
            );
        Ok(count)
    }

    pub fn time(&self) -> &ca_core::virtual_time::VirtualTime {
        self.document.time()
    }

    pub fn set_profiles(&mut self, settings: ca_core::virtual_time::VirtualTime) {
        let mut time = self.document.time().clone();
        time.apply_profiles(&settings);
        self.document.set_time(time);
    }

    pub fn reset_scenario_time(&mut self, clock: ca_core::virtual_time::Clock) {
        self.document.reset_scenario_time(clock);
        self.metrics.reset();
        self.pack();
    }

    /// Rebuild topology storage only on edits; keep live traffic and display shift.
    pub fn edit_streets(&mut self, edit: ca_core::streets::StreetEdit) -> bool {
        let deleted = if let ca_core::streets::StreetEdit::Delete(id) = &edit {
            Some(*id)
        } else {
            None
        };
        let mut document = self.document.clone();
        if document.edit_streets(edit).is_err() {
            return false;
        }
        let mut scene = Self::from_document(&document);
        let delta: [f32; 2] = std::array::from_fn(|i| self.shift[i] - scene.shift[i]);
        for center in scene
            .geometry
            .iter_mut()
            .flat_map(|s| &mut s.centers)
            .flatten()
        {
            for i in 0..2 {
                center[i] += delta[i];
            }
        }
        for lane in &mut scene.lanes {
            for (i, value) in delta.iter().enumerate() {
                lane.origin[i] += value;
            }
        }
        for tile in &mut scene.tiles {
            for (i, value) in delta.iter().enumerate() {
                tile.center[i] += value;
            }
        }
        scene.shift = self.shift;
        scene.extent = std::array::from_fn(|i| {
            self.extent[i].max((scene.extent[i] as f32 + delta[i]).max(1.0).ceil() as u32)
        });
        scene.metrics = std::mem::take(&mut self.metrics);
        scene
            .metrics
            .reconcile(scene.document.model().streets(), deleted);
        *self = scene;
        true
    }

    pub fn set_generation_override(
        &mut self,
        probability: Option<f64>,
    ) -> Result<(), TrafficError> {
        self.document
            .model_mut()
            .set_generation_override(probability)
    }

    pub fn edit_vehicles(
        &mut self,
        action: VehicleAction,
        paused: bool,
    ) -> Result<(), TrafficError> {
        match action {
            VehicleAction::Clear => self.document.model_mut().clear_vehicles(),
            VehicleAction::Fill(probability) => {
                self.document.model_mut().random_fill(probability)?
            }
        }
        self.edited = true;
        if paused {
            self.pack();
        }
        Ok(())
    }

    /// Paused changes are packed before this frame is painted. Running changes
    /// remain in the model until the next completed tick packs the display.
    pub fn toggle_vehicle(&mut self, cell: CellRef, paused: bool) -> bool {
        if !self.document.model_mut().toggle_vehicle(cell) {
            return false;
        }
        self.edited = true;
        if paused {
            self.pack();
        }
        true
    }

    /// Flush edits if the user pauses before a pending simulation tick.
    /// Returns whether the display buffer needs an upload.
    pub fn publish_edits(&mut self) -> bool {
        if !self.edited {
            return false;
        }
        self.pack();
        true
    }

    /// Layout export for interaction tools; never rebuilt on traffic ticks.
    pub fn geometry(&self) -> Vec<StreetGeometry> {
        self.geometry.clone()
    }

    pub fn axes(&self) -> &[Vec<Vec<[f32; 2]>>] {
        &self.axes
    }
    pub fn shift(&self) -> [f32; 2] {
        self.shift
    }

    /// Update only this street in preallocated CPU/GPU layout storage.
    pub fn set_vertex_offset(&mut self, street: usize, vertex: usize, offset: f64) -> bool {
        let Some(placement) = self.placements.get_mut(street) else {
            return false;
        };
        if !placement.set_vertex_offset(vertex, offset) {
            return false;
        }
        self.document.set_vertex_offset(street, vertex, offset);
        let centers = &mut self.geometry[street].centers;
        let axes = &mut self.axes[street];
        placement.write_cells(centers, axes);
        let mut tile = self.street_tiles[street].start;
        for (lane, (centers, axes)) in centers.iter_mut().zip(axes).enumerate() {
            for (center, axis) in centers.iter_mut().zip(axes.iter()) {
                for (i, shift) in self.shift.iter().enumerate() {
                    center[i] += shift;
                }
                self.tiles[tile].center = *center;
                self.tiles[tile].axis = *axis;
                tile += 1;
            }
            for (index, distance) in [(0, -1.5), (centers.len() - 1, 1.5)] {
                self.tiles[tile].center =
                    std::array::from_fn(|i| centers[index][i] + axes[index][i] * distance);
                self.tiles[tile].axis = axes[index];
                tile += 1;
            }
            let layout = &mut self.lanes[self.street_lanes[street].start + lane];
            layout.axis = axes[0];
            layout.origin = [
                centers[0][0] - axes[0][0] * 0.5 + axes[0][1] * 0.5,
                centers[0][1] - axes[0][1] * 0.5 - axes[0][0] * 0.5,
            ];
        }
        true
    }

    pub fn street_names(&self) -> Vec<String> {
        self.names.clone()
    }

    /// World-space arrow endpoints, built on topology edits, never per tick.
    pub fn connection_arrows(&self) -> Vec<ca_core::connections::ConnectionArrow> {
        self.document.model().connection_arrows(&self.geometry)
    }

    /// Topology-only edit: retain live traffic, tick state, and display buffers.
    pub fn add_connection(
        &mut self,
        connection: ca_core::connections::Connection,
    ) -> Result<(), ca_core::connections::ConnectionError> {
        self.document.add_connection(connection)
    }

    pub fn replace_connection(
        &mut self,
        index: usize,
        connection: ca_core::connections::Connection,
    ) -> Result<(), ca_core::connections::ConnectionError> {
        self.document.replace_connection(index, connection)
    }

    pub fn delete_connection(&mut self, index: usize) -> bool {
        self.document.delete_connection(index)
    }

    pub fn lanes(&self) -> &[TrafficLane] {
        &self.lanes
    }

    pub fn cells(&self) -> &[u32] {
        &self.cells
    }

    pub fn extent(&self) -> [u32; 2] {
        self.extent
    }

    /// Value 7 is a special cell, not one of the six vehicle classes.
    pub fn population(&self) -> u32 {
        self.cells.iter().filter(|&&v| (1..=6).contains(&v)).count() as u32
    }
}

pub struct TrafficDisplay {
    state: wgpu::Buffer,
    view: wgpu::Buffer,
    group: wgpu::BindGroup,
    pipeline: wgpu::RenderPipeline,
    heat_pipeline: wgpu::RenderPipeline,
    instances: u32,
    street_instances: Vec<std::ops::Range<u32>>,
    layout: wgpu::Buffer,
    background: crate::background::BackgroundDisplay,
    buildings: crate::background::BackgroundDisplay,
}

impl TrafficDisplay {
    pub fn new(device: &wgpu::Device, scene: &TrafficScene, format: wgpu::TextureFormat) -> Self {
        let state = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("traffic cell storage"),
            contents: bytemuck::cast_slice(if scene.cells().is_empty() {
                &[0]
            } else {
                scene.cells()
            }),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let lanes = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("traffic oriented cell instances"),
            contents: if scene.tiles.is_empty() {
                &[0; 32]
            } else {
                bytemuck::cast_slice(&scene.tiles)
            },
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let heat_lanes = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("static vehicle heat lane bounds"),
            contents: if scene.heat_lanes.is_empty() {
                &[0; 16]
            } else {
                bytemuck::cast_slice(&scene.heat_lanes)
            },
            usage: wgpu::BufferUsages::STORAGE,
        });
        let [width, height] = scene.extent();
        let dims = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("traffic view dimensions"),
            contents: bytemuck::bytes_of(&ViewUniform {
                origin: [0.0; 2],
                span: [width as f32, height as f32],
            }),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let fragment = wgpu::ShaderStages::VERTEX_FRAGMENT;
        let read = wgpu::BufferBindingType::Storage { read_only: true };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("traffic display bindings"),
            entries: &[
                entry(0, fragment, wgpu::BufferBindingType::Uniform),
                entry(1, fragment, read),
                entry(2, fragment, read),
                entry(3, wgpu::ShaderStages::VERTEX, read),
            ],
        });
        let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("traffic display group"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: dims.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: state.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: lanes.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: heat_lanes.as_entire_binding(),
                },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("traffic lane and vehicle shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("traffic.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("traffic display pipeline layout"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        // Compile both at reset. The normal shader has no heat-window reads or math.
        let create_pipeline = |heat: bool| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(if heat {
                    "vehicle heat display pipeline"
                } else {
                    "traffic display pipeline"
                }),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions {
                        constants: &[("HEAT_MODE", f64::from(heat))],
                        ..Default::default()
                    },
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some("fs_main"),
                    compilation_options: wgpu::PipelineCompilationOptions {
                        constants: &[("HEAT_MODE", f64::from(heat))],
                        ..Default::default()
                    },
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview: None,
                cache: None,
            })
        };
        let pipeline = create_pipeline(false);
        let heat_pipeline = create_pipeline(true);
        Self {
            background: crate::background::BackgroundDisplay::new(
                device,
                &dims,
                &scene.zones,
                scene.shift,
                format,
            ),
            buildings: crate::background::BackgroundDisplay::new(
                device,
                &dims,
                &scene
                    .document
                    .buildings()
                    .iter()
                    .map(crate::building_zone)
                    .collect::<Vec<_>>(),
                scene.shift,
                format,
            ),
            state,
            view: dims,
            group,
            pipeline,
            heat_pipeline,
            instances: scene.tiles.len() as u32,
            street_instances: scene
                .street_tiles
                .iter()
                .map(|range| range.start as u32..range.end as u32)
                .collect(),
            layout: lanes,
        }
    }

    pub fn upload(&self, queue: &wgpu::Queue, scene: &TrafficScene) {
        if !scene.cells().is_empty() {
            queue.write_buffer(&self.state, 0, bytemuck::cast_slice(scene.cells()));
        }
    }

    pub fn set_view(&self, queue: &wgpu::Queue, view: WorldView) {
        queue.write_buffer(
            &self.view,
            0,
            bytemuck::bytes_of(&ViewUniform {
                origin: view.origin,
                span: view.span,
            }),
        );
    }

    pub fn upload_street(&self, queue: &wgpu::Queue, scene: &TrafficScene, street: usize) {
        assert_eq!(self.instances as usize, scene.tiles.len());
        let range = scene.street_tiles[street].clone();
        queue.write_buffer(
            &self.layout,
            (range.start * size_of::<TrafficTile>()) as u64,
            bytemuck::cast_slice(&scene.tiles[range]),
        );
    }

    pub fn paint(&self, pass: &mut wgpu::RenderPass<'_>) {
        self.paint_excluding(pass, None);
    }

    /// Replace one street with a UI preview without editing or uploading the model.
    pub fn paint_excluding(&self, pass: &mut wgpu::RenderPass<'_>, street: Option<usize>) {
        self.paint_styled(pass, street, VehicleStyle::Classes);
    }

    /// Change only the display pipeline. Traffic buffers and draw ranges are shared.
    pub fn paint_styled(
        &self,
        pass: &mut wgpu::RenderPass<'_>,
        street: Option<usize>,
        style: VehicleStyle,
    ) {
        pass.set_pipeline(match style {
            VehicleStyle::Classes => &self.pipeline,
            VehicleStyle::Heat => &self.heat_pipeline,
        });
        pass.set_bind_group(0, &self.group, &[]);
        if let Some(range) = street.and_then(|s| self.street_instances.get(s)) {
            if range.start > 0 {
                pass.draw(0..6, 0..range.start);
            }
            if range.end < self.instances {
                pass.draw(0..6, range.end..self.instances);
            }
        } else {
            pass.draw(0..6, 0..self.instances);
        }
    }

    pub fn paint_background(&self, pass: &mut wgpu::RenderPass<'_>) {
        self.background.paint(pass);
        self.buildings.paint(pass);
    }

    pub fn paint_zones(&self, pass: &mut wgpu::RenderPass<'_>) {
        self.background.paint(pass);
    }

    /// Retained triangle ranges let the app interleave shapes with image quads.
    pub fn paint_building(&self, pass: &mut wgpu::RenderPass<'_>, index: usize) {
        self.buildings.paint_zone(pass, index);
    }

    pub fn set_buildings(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        zones: &[ca_core::map_json::BackgroundZone],
        shift: [f32; 2],
    ) {
        self.buildings.update(device, queue, zones, shift);
    }
}
