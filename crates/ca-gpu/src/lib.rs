//! GPU kernels and asynchronous population readback.
use bytemuck::{Pod, Zeroable};
pub use ca_core::{Grid, PopulationSample};
use crossbeam_channel::{Receiver, Sender, bounded};
use wgpu::util::DeviceExt;

#[derive(Debug, thiserror::Error)]
pub enum GpuError {
    #[error("device polling failed: {0}")]
    Poll(#[from] wgpu::PollError),
    #[error("population staging buffer mapping failed")]
    Mapping,
    #[error("reset dimensions differ from the allocated grid")]
    Dimensions,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Dimensions {
    width: u32,
    height: u32,
    padding: [u32; 2],
}
const _: () = assert!(size_of::<Dimensions>() == 16);

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Brush {
    pub center: [i32; 2],
    pub radius: u32,
    pub value: u32,
}
const _: () = assert!(size_of::<Brush>() == 16);

struct Staging {
    buffer: wgpu::Buffer,
    sample: Option<PopulationSample>,
}

pub struct Simulation {
    width: u32,
    height: u32,
    states: [wgpu::Buffer; 2],
    current: usize,
    brush_uniform: wgpu::Buffer,
    counter: wgpu::Buffer,
    groups: [wgpu::BindGroup; 2],
    render_groups: [wgpu::BindGroup; 2],
    step_pipeline: wgpu::ComputePipeline,
    brush_pipeline: wgpu::ComputePipeline,
    reduce_pipeline: wgpu::ComputePipeline,
    render_pipeline: wgpu::RenderPipeline,
    staging: [Staging; 3],
    completed_tx: Sender<(usize, bool)>,
    completed_rx: Receiver<(usize, bool)>,
}

fn buffer(
    device: &wgpu::Device,
    label: &str,
    size: u64,
    usage: wgpu::BufferUsages,
) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size,
        usage,
        mapped_at_creation: false,
    })
}
fn entry(
    binding: u32,
    visibility: wgpu::ShaderStages,
    ty: wgpu::BufferBindingType,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Buffer {
            ty,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

impl Simulation {
    pub fn new(device: &wgpu::Device, grid: &Grid, format: wgpu::TextureFormat) -> Self {
        let dims = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("ca dimensions"),
            contents: bytemuck::bytes_of(&Dimensions {
                width: grid.width,
                height: grid.height,
                padding: [0; 2],
            }),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let states = ["ca state A", "ca state B"].map(|label| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: bytemuck::cast_slice(grid.cells()),
                usage: wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::COPY_DST
                    | wgpu::BufferUsages::COPY_SRC,
            })
        });
        let brush_uniform = buffer(
            device,
            "ca brush uniform",
            16,
            wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        );
        let counter = buffer(
            device,
            "ca population counter",
            4,
            wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::COPY_SRC,
        );
        let compute = wgpu::ShaderStages::COMPUTE;
        let uniform = wgpu::BufferBindingType::Uniform;
        let read = wgpu::BufferBindingType::Storage { read_only: true };
        let write = wgpu::BufferBindingType::Storage { read_only: false };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ca compute bindings"),
            entries: &[
                entry(0, compute, uniform),
                entry(1, compute, read),
                entry(2, compute, write),
                entry(3, compute, uniform),
                entry(4, compute, write),
            ],
        });
        let render_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ca render bindings"),
            entries: &[
                entry(0, wgpu::ShaderStages::FRAGMENT, uniform),
                entry(1, wgpu::ShaderStages::FRAGMENT, read),
            ],
        });
        let groups = std::array::from_fn(|i| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(if i == 0 { "ca A to B" } else { "ca B to A" }),
                layout: &layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: dims.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: states[i].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: states[1 - i].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: brush_uniform.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: counter.as_entire_binding(),
                    },
                ],
            })
        });
        let render_groups = std::array::from_fn(|i| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(if i == 0 { "ca render A" } else { "ca render B" }),
                layout: &render_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: dims.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: states[i].as_entire_binding(),
                    },
                ],
            })
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("ca compute pipeline layout"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let kernel = |label: &'static str, source: &'static str| {
            let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(label),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(label),
                layout: Some(&pipeline_layout),
                module: &module,
                entry_point: Some("main"),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        let step_pipeline = kernel("ca Conway step", include_str!("step.wgsl"));
        let brush_pipeline = kernel("ca circular brush", include_str!("brush.wgsl"));
        let reduce_pipeline = kernel("ca population reduction", include_str!("reduce.wgsl"));
        let render_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ca render shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("render.wgsl").into()),
        });
        let render_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("ca render pipeline layout"),
                bind_group_layouts: &[&render_layout],
                push_constant_ranges: &[],
            });
        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ca render pipeline"),
            layout: Some(&render_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &render_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &render_shader,
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
        let staging = [
            "ca population staging 0",
            "ca population staging 1",
            "ca population staging 2",
        ]
        .map(|label| Staging {
            buffer: buffer(
                device,
                label,
                4,
                wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            ),
            sample: None,
        });
        let (completed_tx, completed_rx) = bounded(3);
        Self {
            width: grid.width,
            height: grid.height,
            states,
            current: 0,
            brush_uniform,
            counter,
            groups,
            render_groups,
            step_pipeline,
            brush_pipeline,
            reduce_pipeline,
            render_pipeline,
            staging,
            completed_tx,
            completed_rx,
        }
    }

    pub fn reset(&mut self, queue: &wgpu::Queue, grid: &Grid) -> Result<(), GpuError> {
        if (grid.width, grid.height) != (self.width, self.height) {
            return Err(GpuError::Dimensions);
        }
        for state in &self.states {
            queue.write_buffer(state, 0, bytemuck::cast_slice(grid.cells()));
        }
        self.current = 0;
        // Pending samples retain their epoch and are discarded by the application.
        Ok(())
    }

    pub fn step(&mut self, encoder: &mut wgpu::CommandEncoder, generations: u32) {
        puffin::profile_scope!("sim dispatch");
        if generations == 0 {
            return;
        }
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("ca simulation batch"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.step_pipeline);
        for _ in 0..generations {
            pass.set_bind_group(0, &self.groups[self.current], &[]);
            pass.dispatch_workgroups(self.width.div_ceil(8), self.height.div_ceil(8), 1);
            self.current = 1 - self.current;
        }
    }

    pub fn brush(&self, queue: &wgpu::Queue, encoder: &mut wgpu::CommandEncoder, brush: Brush) {
        puffin::profile_scope!("brush dispatch");
        queue.write_buffer(&self.brush_uniform, 0, bytemuck::bytes_of(&brush));
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("ca brush pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.brush_pipeline);
        pass.set_bind_group(0, &self.groups[1 - self.current], &[]);
        pass.dispatch_workgroups(self.width.div_ceil(8), self.height.div_ceil(8), 1);
    }

    /// Reduce once per batch. If all slots are busy, discard this sample, never wait.
    pub fn sample(&mut self, encoder: &mut wgpu::CommandEncoder, epoch: u64, generation: u64) {
        encoder.clear_buffer(&self.counter, 0, None);
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("ca reduction pass"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.reduce_pipeline);
            pass.set_bind_group(0, &self.groups[self.current], &[]);
            pass.dispatch_workgroups(self.width.div_ceil(8), self.height.div_ceil(8), 1);
        }
        if let Some((index, slot)) = self
            .staging
            .iter_mut()
            .enumerate()
            .find(|(_, s)| s.sample.is_none())
        {
            slot.sample = Some(PopulationSample {
                epoch,
                generation,
                population: 0,
            });
            encoder.copy_buffer_to_buffer(&self.counter, 0, &slot.buffer, 0, 4);
            let tx = self.completed_tx.clone();
            // Registers map_async after submission, not before the pending GPU copy.
            encoder.map_buffer_on_submit(&slot.buffer, wgpu::MapMode::Read, .., move |result| {
                let _ = tx.try_send((index, result.is_ok()));
            });
        }
    }

    pub fn poll(&mut self, device: &wgpu::Device) -> Result<Option<PopulationSample>, GpuError> {
        puffin::profile_scope!("readback polling");
        device.poll(wgpu::PollType::Poll)?;
        let Ok((index, success)) = self.completed_rx.try_recv() else {
            return Ok(None);
        };
        let slot = &mut self.staging[index];
        let sample = slot.sample.take();
        if !success {
            return Err(GpuError::Mapping);
        }
        let mapped = slot.buffer.slice(..).get_mapped_range();
        let population = bytemuck::pod_read_unaligned::<u32>(&mapped);
        drop(mapped);
        slot.buffer.unmap();
        Ok(sample.map(|s| PopulationSample { population, ..s }))
    }

    pub fn paint(&self, pass: &mut wgpu::RenderPass<'_>) {
        pass.set_pipeline(&self.render_pipeline);
        pass.set_bind_group(0, &self.render_groups[self.current], &[]);
        pass.draw(0..3, 0..1);
    }

    /// Test/debug oracle only. Never use for the display path.
    pub fn copy_state(&self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::Buffer) {
        encoder.copy_buffer_to_buffer(
            &self.states[self.current],
            0,
            target,
            0,
            u64::from(self.width) * u64::from(self.height) * 4,
        );
    }
}
