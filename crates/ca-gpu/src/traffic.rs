//! CPU traffic state packed once per completed batch for direct GPU display.
use bytemuck::{Pod, Zeroable};
use ca_core::camera::WorldView;
use ca_core::cell_index::{CellRef, StreetGeometry};
use ca_core::traffic::{CalleType, LaneDirection, TrafficError, VehicleAction};
use wgpu::util::DeviceExt;

use crate::{ViewUniform, entry};

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
    arrow: u32,
}
const _: () = assert!(size_of::<TrafficTile>() == 32);

pub struct TrafficScene {
    lanes: Vec<TrafficLane>,
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
                offset += street.config().tamano as u32;
            }
        }
        for point in document.zones().iter().flat_map(|zone| &zone.points) {
            for i in 0..2 {
                minimum[i] = minimum[i].min(point[i]);
                maximum[i] = maximum[i].max(point[i]);
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
                        arrow: 0,
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
                        arrow: 1,
                    });
                }
            }
            street_tiles.push(start..tiles.len());
            street_lanes.push(lane_start..lane_start + street.centers.len());
            lane_start += street.centers.len();
        }
        let mut scene = Self {
            lanes,
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
        for (target, value) in self.cells.iter_mut().zip(
            self.document
                .model()
                .streets()
                .iter()
                .flat_map(|street| street.cells()),
        ) {
            *target = u32::from(*value);
        }
        self.edited = false;
    }

    pub fn tick(&mut self) {
        self.document.model_mut().tick();
        self.pack();
    }

    /// Rebuild topology storage only on edits; keep live traffic and display shift.
    pub fn edit_streets(&mut self, edit: ca_core::streets::StreetEdit) -> bool {
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
    instances: u32,
    street_instances: Vec<std::ops::Range<u32>>,
    layout: wgpu::Buffer,
    background: crate::background::BackgroundDisplay,
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
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("traffic display pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
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
        });
        Self {
            background: crate::background::BackgroundDisplay::new(
                device,
                &dims,
                &scene.zones,
                scene.shift,
                format,
            ),
            state,
            view: dims,
            group,
            pipeline,
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
        pass.set_pipeline(&self.pipeline);
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
    }
}
