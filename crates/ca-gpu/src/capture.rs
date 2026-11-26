//! User-triggered offscreen capture, separate from the live display.
use crate::TrafficScene;
use ca_core::camera::WorldView;
use wgpu::util::DeviceExt;

#[derive(Debug, PartialEq)]
pub struct CapturedImage {
    pub pixels: [u32; 2],
    pub rgba: Vec<u8>,
}

/// Straight-alpha RGBA artwork in shifted display-world coordinates.
pub struct CaptureImage {
    /// None draws below buildings (the reference image).
    pub building: Option<usize>,
    pub corners: [[f32; 2]; 4],
    pub pixels: [u32; 2],
    pub rgba: Vec<u8>,
    pub opacity: f32,
}

pub struct Capture {
    buffer: wgpu::Buffer,
    ready: std::sync::mpsc::Receiver<Result<(), wgpu::BufferAsyncError>>,
    pixels: [u32; 2],
    stride: u32,
}

impl Capture {
    /// One render and one readback. Call on a worker: resource creation can be costly.
    /// No live display buffers, uniforms, or camera state are accessed.
    pub fn start(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        scene: &TrafficScene,
        plan: CapturePlan,
        style: crate::VehicleStyle,
        images: &[CaptureImage],
    ) -> Result<Self, String> {
        if CapturePlan::viewport(plan.view, plan.pixels).is_none()
            || plan
                .pixels
                .into_iter()
                .any(|n| n > device.limits().max_texture_dimension_2d)
        {
            return Err("Invalid capture dimensions".into());
        }
        let display = crate::TrafficDisplay::new(device, scene, wgpu::TextureFormat::Rgba8Unorm);
        let background = scene
            .document()
            .map_background()
            .rgb(scene.document().time().clock);
        display.set_view(queue, plan.view);
        let images = ImageLayer::new(device, queue, plan.view, images)?;
        let size = wgpu::Extent3d {
            width: plan.pixels[0],
            height: plan.pixels[1],
            depth_or_array_layers: 1,
        };
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("map capture offscreen texture"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let stride = (size.width * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
            * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("user-triggered map capture readback"),
            size: u64::from(stride) * u64::from(size.height),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let view = texture.create_view(&Default::default());
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("map capture encoder"),
        });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("opaque map capture"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: f64::from(background[0]) / 255.,
                            g: f64::from(background[1]) / 255.,
                            b: f64::from(background[2]) / 255.,
                            a: 1.,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            display.paint_zones(&mut pass);
            images.paint(&mut pass, None);
            for index in 0..scene.document().buildings().len() {
                display.paint_building(&mut pass, index);
                images.paint(&mut pass, Some(index));
            }
            display.paint_styled(&mut pass, None, style);
        }
        encoder.copy_texture_to_buffer(
            texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(stride),
                    rows_per_image: None,
                },
            },
            size,
        );
        queue.submit([encoder.finish()]);
        let (tx, ready) = std::sync::mpsc::sync_channel(1);
        buffer.map_async(wgpu::MapMode::Read, .., move |result| {
            let _ = tx.try_send(result);
        });
        Ok(Self {
            buffer,
            ready,
            pixels: plan.pixels,
            stride,
        })
    }

    /// Worker-only wait. The UI must receive the result through a non-blocking channel.
    pub fn read_on_worker(self, device: &wgpu::Device) -> Result<CapturedImage, String> {
        loop {
            // A waiting device poll holds wgpu's fence lock and can delay live
            // queue submission, even on a worker. Only poll without waiting.
            device
                .poll(wgpu::PollType::Poll)
                .map_err(|e| e.to_string())?;
            match self.ready.recv_timeout(std::time::Duration::from_millis(2)) {
                Ok(result) => {
                    result.map_err(|e| e.to_string())?;
                    break;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(error) => return Err(error.to_string()),
            }
        }
        let mapped = self.buffer.slice(..).get_mapped_range();
        let mut rgba = Vec::with_capacity((self.pixels[0] * self.pixels[1] * 4) as usize);
        for row in mapped.chunks_exact(self.stride as usize) {
            rgba.extend_from_slice(&row[..self.pixels[0] as usize * 4]);
        }
        drop(mapped);
        self.buffer.unmap();
        Ok(CapturedImage {
            pixels: self.pixels,
            rgba,
        })
    }
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct ImageVertex {
    point: [f32; 2],
    uv: [f32; 2],
    opacity: f32,
}
const _: () = assert!(size_of::<ImageVertex>() == 20);

struct ImageLayer {
    pipeline: wgpu::RenderPipeline,
    entries: Vec<(Option<usize>, wgpu::BindGroup, wgpu::Buffer)>,
}

impl ImageLayer {
    fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        view: WorldView,
        images: &[CaptureImage],
    ) -> Result<Self, String> {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("capture artwork shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("capture.wgsl").into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("capture artwork bindings"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("capture artwork pipeline layout"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("capture artwork pipeline"), layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader, entry_point: Some("vs_main"), compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: 20, step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x2, 2 => Float32],
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader, entry_point: Some("fs_main"), compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8Unorm, blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(), depth_stencil: None, multisample: Default::default(), multiview: None, cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("capture artwork sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let mut entries = Vec::new();
        for image in images {
            if image
                .pixels
                .into_iter()
                .any(|n| n == 0 || n > device.limits().max_texture_dimension_2d)
                || image.rgba.len() as u64
                    != u64::from(image.pixels[0]) * u64::from(image.pixels[1]) * 4
            {
                return Err("Invalid capture artwork".into());
            }
            let size = wgpu::Extent3d {
                width: image.pixels[0],
                height: image.pixels[1],
                depth_or_array_layers: 1,
            };
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("capture artwork texture"),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            queue.write_texture(
                texture.as_image_copy(),
                &image.rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(size.width * 4),
                    rows_per_image: None,
                },
                size,
            );
            let texture_view = texture.create_view(&Default::default());
            let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("capture artwork group"),
                layout: &layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&texture_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&sampler),
                    },
                ],
            });
            let uv = [[0., 0.], [1., 0.], [1., 1.], [0., 1.]];
            let vertices = [0, 1, 2, 0, 2, 3].map(|index| ImageVertex {
                point: [
                    (image.corners[index][0] - view.origin[0]) / view.span[0] * 2. - 1.,
                    1. - (image.corners[index][1] - view.origin[1]) / view.span[1] * 2.,
                ],
                uv: uv[index],
                opacity: image.opacity.clamp(0., 1.),
            });
            let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("capture artwork vertices"),
                contents: bytemuck::cast_slice(&vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
            entries.push((image.building, group, buffer));
        }
        Ok(Self { pipeline, entries })
    }

    fn paint(&self, pass: &mut wgpu::RenderPass<'_>, building: Option<usize>) {
        pass.set_pipeline(&self.pipeline);
        for (owner, group, buffer) in &self.entries {
            if *owner == building {
                pass.set_bind_group(0, group, &[]);
                pass.set_vertex_buffer(0, buffer.slice(..));
                pass.draw(0..6, 0..1);
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CapturePlan {
    pub view: WorldView,
    pub pixels: [u32; 2],
}

impl CapturePlan {
    pub fn whole_map(scene: &TrafficScene) -> Option<Self> {
        let mut min = [f64::INFINITY; 2];
        let mut max = [f64::NEG_INFINITY; 2];
        let mut include = |point: [f64; 2]| {
            for i in 0..2 {
                min[i] = min[i].min(point[i]);
                max[i] = max[i].max(point[i]);
            }
        };
        let document = scene.document();
        let geometry = document.geometry_snapshot();
        for (id, street) in geometry.streets.iter().enumerate() {
            for (centers, axes) in street.centers.iter().zip(&geometry.axes[id]) {
                for (center, axis) in centers.iter().zip(axes) {
                    let radius = f64::from(axis[0].abs() + axis[1].abs()) * 0.5;
                    include(center.map(|n| f64::from(n) - radius));
                    include(center.map(|n| f64::from(n) + radius));
                }
            }
            if let Some(ring) = document.layout()[id].roundabout {
                let radius = ring.inner_radius + street.centers.len() as f64;
                include(ring.center.map(|n| n - radius));
                include(ring.center.map(|n| n + radius));
            }
        }
        for building in document.buildings() {
            for point in building.bounds() {
                include(point.map(|n| n / 5.));
            }
        }
        if let Some(reference) = document.reference_image().filter(|r| r.visible) {
            for point in reference.corners {
                include(point.map(|n| n / 5.));
            }
        }
        if !min[0].is_finite() {
            return None;
        }
        let origin = std::array::from_fn(|i| (min[i] - 2.4) as f32 + scene.shift()[i]);
        let span = std::array::from_fn(|i| (max[i] - min[i] + 4.8) as f32);
        // A world unit is five v1 pixels; v1 caps scale at eight pixels per pixel.
        let scale = (2400. / span[0].max(span[1])).min(40.);
        Some(Self {
            view: WorldView { origin, span },
            pixels: span.map(|n| (n * scale).round().clamp(1., 2400.) as u32),
        })
    }

    /// Exact visible world rectangle; dimensions are physical output pixels.
    pub fn viewport(view: WorldView, pixels: [u32; 2]) -> Option<Self> {
        (pixels.into_iter().all(|n| n > 0 && n <= 8192)
            && view.origin.into_iter().all(f32::is_finite)
            && view.span.into_iter().all(|n| n.is_finite() && n > 0.))
        .then_some(Self { view, pixels })
    }
}
