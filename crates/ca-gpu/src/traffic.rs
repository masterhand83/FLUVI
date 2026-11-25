//! CPU traffic state packed once per completed batch for direct GPU display.
use bytemuck::{Pod, Zeroable};
use ca_core::camera::WorldView;
use ca_core::cell_index::{CellRef, StreetGeometry};
use ca_core::traffic::{CalleType, LaneDirection, TrafficModel};
use wgpu::util::DeviceExt;

use crate::{ViewUniform, entry};

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct TrafficLane {
    pub origin: [u32; 2],
    pub offset: u32,
    pub length: u32,
    /// 1 means physical indices increase in the travel direction; 0 reverses it.
    pub direction: u32,
    pub street_type: u32,
    pub padding: [u32; 2],
}
const _: () = assert!(size_of::<TrafficLane>() == 32);

pub struct TrafficScene {
    model: TrafficModel,
    lanes: Vec<TrafficLane>,
    cells: Vec<u32>,
    edited: bool,
}

impl TrafficScene {
    pub fn demo() -> Self {
        let model = TrafficModel::demo();
        let mut lanes = Vec::with_capacity(6);
        let mut offset = 0;
        for (street_index, street) in model.streets().iter().enumerate() {
            for lane in 0..street.config().carriles {
                lanes.push(TrafficLane {
                    origin: [2, 2 + street_index as u32 * 4 + lane as u32],
                    offset,
                    length: street.config().tamano as u32,
                    direction: u32::from(street.lane_direction(lane) == LaneDirection::Forward),
                    street_type: match street.config().tipo {
                        CalleType::Generador => 0,
                        CalleType::Conexion => 1,
                        CalleType::Devorador => 2,
                    },
                    padding: [0; 2],
                });
                offset += street.config().tamano as u32;
            }
        }
        let mut scene = Self {
            model,
            lanes,
            cells: vec![0; offset as usize],
            edited: false,
        };
        scene.pack();
        scene
    }

    fn pack(&mut self) {
        for (target, value) in self.cells.iter_mut().zip(
            self.model
                .streets()
                .iter()
                .flat_map(|street| street.cells()),
        ) {
            *target = u32::from(*value);
        }
        self.edited = false;
    }

    pub fn tick(&mut self) {
        self.model.tick();
        self.pack();
    }

    /// Paused changes are packed before this frame is painted. Running changes
    /// remain in the model until the next completed tick packs the display.
    pub fn toggle_vehicle(&mut self, cell: CellRef, paused: bool) -> bool {
        if !self.model.toggle_vehicle(cell) {
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
        let mut lanes = self.lanes.iter();
        self.model
            .streets()
            .iter()
            .enumerate()
            .map(|(id, street)| StreetGeometry {
                id,
                centers: (0..street.config().carriles)
                    .map(|_| {
                        let lane = lanes.next().expect("one layout per model lane");
                        (0..lane.length)
                            .map(|i| {
                                [
                                    lane.origin[0] as f32 + i as f32 + 0.5,
                                    lane.origin[1] as f32 + 0.5,
                                ]
                            })
                            .collect()
                    })
                    .collect(),
            })
            .collect()
    }

    pub fn street_names(&self) -> Vec<String> {
        // Tracer-map names are data, not translated UI labels.
        ["Generador", "Conexion", "Devorador"]
            .map(String::from)
            .to_vec()
    }

    pub fn lanes(&self) -> &[TrafficLane] {
        &self.lanes
    }

    pub fn cells(&self) -> &[u32] {
        &self.cells
    }

    pub fn extent(&self) -> [u32; 2] {
        [36, 14]
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
}

impl TrafficDisplay {
    pub fn new(device: &wgpu::Device, scene: &TrafficScene, format: wgpu::TextureFormat) -> Self {
        let state = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("traffic cell storage"),
            contents: bytemuck::cast_slice(scene.cells()),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let lanes = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("traffic physical lane layout"),
            contents: bytemuck::cast_slice(scene.lanes()),
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
        let fragment = wgpu::ShaderStages::FRAGMENT;
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
            state,
            view: dims,
            group,
            pipeline,
        }
    }

    pub fn upload(&self, queue: &wgpu::Queue, scene: &TrafficScene) {
        queue.write_buffer(&self.state, 0, bytemuck::cast_slice(scene.cells()));
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

    pub fn paint(&self, pass: &mut wgpu::RenderPass<'_>) {
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.group, &[]);
        pass.draw(0..3, 0..1);
    }
}
