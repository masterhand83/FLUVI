//! Static zone triangles. Allocate once on map installation, never on paint.
use bytemuck::{Pod, Zeroable};
use ca_core::map_json::BackgroundZone;
use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ZoneVertex {
    point: [f32; 2],
    padding: [f32; 2],
    color: [f32; 4],
}
const _: () = assert!(size_of::<ZoneVertex>() == 32);

pub(crate) struct BackgroundDisplay {
    group: wgpu::BindGroup,
    pipeline: wgpu::RenderPipeline,
    count: u32,
}

impl BackgroundDisplay {
    pub fn new(
        device: &wgpu::Device,
        view: &wgpu::Buffer,
        zones: &[BackgroundZone],
        shift: [f32; 2],
        format: wgpu::TextureFormat,
    ) -> Self {
        let mut vertices = Vec::new();
        for zone in zones {
            let color = zone.color.map(|c| c as f32 / 255.0);
            for index in triangulate(&zone.points) {
                vertices.push(ZoneVertex {
                    point: std::array::from_fn(|i| zone.points[index as usize][i] + shift[i]),
                    padding: [0.0; 2],
                    color,
                });
            }
            if zone.show_border {
                for (a, b) in zone.points.iter().zip(zone.points.iter().cycle().skip(1)) {
                    let delta = [b[0] - a[0], b[1] - a[1]];
                    let length = delta[0].hypot(delta[1]);
                    if length == 0.0 {
                        continue;
                    }
                    let normal = [-delta[1] / length * 0.15, delta[0] / length * 0.15];
                    let points: [[f32; 2]; 4] = [
                        std::array::from_fn(|i| a[i] + normal[i]),
                        std::array::from_fn(|i| a[i] - normal[i]),
                        std::array::from_fn(|i| b[i] + normal[i]),
                        std::array::from_fn(|i| b[i] - normal[i]),
                    ];
                    for index in [0, 1, 2, 2, 1, 3] {
                        vertices.push(ZoneVertex {
                            point: std::array::from_fn(|i| points[index][i] + shift[i]),
                            padding: [0.0; 2],
                            color,
                        });
                    }
                }
            }
        }
        let count = vertices.len() as u32;
        let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("static background zone triangles"),
            contents: if vertices.is_empty() {
                &[0; 32]
            } else {
                bytemuck::cast_slice(&vertices)
            },
            usage: wgpu::BufferUsages::STORAGE,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("zone bindings"),
            entries: &[
                crate::entry(
                    0,
                    wgpu::ShaderStages::VERTEX,
                    wgpu::BufferBindingType::Uniform,
                ),
                crate::entry(
                    1,
                    wgpu::ShaderStages::VERTEX,
                    wgpu::BufferBindingType::Storage { read_only: true },
                ),
            ],
        });
        let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("zone group"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: view.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: buffer.as_entire_binding(),
                },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("static zone shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("background.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("zone pipeline layout"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("zone display pipeline"),
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
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
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
            group,
            pipeline,
            count,
        }
    }

    pub fn paint(&self, pass: &mut wgpu::RenderPass<'_>) {
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.group, &[]);
        pass.draw(0..self.count, 0..1);
    }
}

// Ear clipping accepts the concave campus boundary in either winding order.
fn triangulate(points: &[[f32; 2]]) -> Vec<u32> {
    let cross = |a: [f32; 2], b: [f32; 2], c: [f32; 2]| {
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    };
    let area: f32 = points
        .iter()
        .zip(points.iter().cycle().skip(1))
        .map(|(a, b)| a[0] * b[1] - b[0] * a[1])
        .sum();
    let sign = area.signum();
    let mut remaining: Vec<_> = (0..points.len()).collect();
    let mut triangles = Vec::new();
    while remaining.len() >= 3 {
        let ear = (0..remaining.len()).find(|&i| {
            let a = remaining[(i + remaining.len() - 1) % remaining.len()];
            let b = remaining[i];
            let c = remaining[(i + 1) % remaining.len()];
            cross(points[a], points[b], points[c]) * sign > 0.0
                && !remaining
                    .iter()
                    .filter(|&&p| p != a && p != b && p != c)
                    .any(|&p| {
                        cross(points[a], points[b], points[p]) * sign >= 0.0
                            && cross(points[b], points[c], points[p]) * sign >= 0.0
                            && cross(points[c], points[a], points[p]) * sign >= 0.0
                    })
        });
        let Some(i) = ear else {
            break;
        };
        triangles.extend([
            remaining[(i + remaining.len() - 1) % remaining.len()] as u32,
            remaining[i] as u32,
            remaining[(i + 1) % remaining.len()] as u32,
        ]);
        remaining.remove(i);
    }
    triangles
}
