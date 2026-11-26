use ca_core::{camera::WorldView, cell_index::CellRef, map_json::MapDocument};
use ca_gpu::{TrafficDisplay, TrafficScene, VehicleStyle};

struct Target {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    size: wgpu::Extent3d,
}

impl Target {
    fn new(device: &wgpu::Device) -> Self {
        let size = wgpu::Extent3d {
            width: 1152,
            height: 448,
            depth_or_array_layers: 1,
        };
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vehicle heat image oracle"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        Self {
            texture,
            view,
            size,
        }
    }

    fn render(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        display: &TrafficDisplay,
        style: VehicleStyle,
    ) -> Vec<u8> {
        let output = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("vehicle heat test readback"),
            size: u64::from(self.size.width * self.size.height * 4),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("vehicle heat image test"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            display.paint_styled(&mut pass, None, style);
        }
        encoder.copy_texture_to_buffer(
            self.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &output,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(self.size.width * 4),
                    rows_per_image: None,
                },
            },
            self.size,
        );
        queue.submit([encoder.finish()]);
        let (tx, rx) = std::sync::mpsc::channel();
        output.map_async(wgpu::MapMode::Read, .., move |result| {
            tx.send(result).unwrap()
        });
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        rx.recv().unwrap().unwrap();
        output.slice(..).get_mapped_range().to_vec()
    }
}

fn device() -> (wgpu::Device, wgpu::Queue) {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    pollster::block_on(adapter.request_device(&Default::default())).unwrap()
}

fn pixel(bytes: &[u8], point: [f32; 2]) -> [u8; 4] {
    let offset = ((point[1] * 32.) as usize * 1152 + (point[0] * 32.) as usize) * 4;
    bytes[offset..offset + 4].try_into().unwrap()
}

fn assert_rgb(actual: [u8; 4], expected: [u8; 3]) {
    for i in 0..3 {
        assert!(
            actual[i].abs_diff(expected[i]) <= 1,
            "{actual:?} != {expected:?}"
        );
    }
}

#[test]
fn heat_wraps_roundabouts_without_repeating_small_rings_or_crossing_lanes() {
    let mut document = MapDocument::parse(r#"{"calles":[
        {"nombre":"Small","tipo":"conexion","tamano":4,"carriles":2,"x":10,"y":20,"geometryType":"roundabout","innerRadius":1,"startAngle":0,"laneDirections":[1,-1]},
        {"nombre":"Large","tipo":"conexion","tamano":9,"carriles":2,"x":50,"y":20,"geometryType":"roundabout","innerRadius":5,"startAngle":0,"laneDirections":[1,-1]}
    ]}"#).unwrap();
    for (street, last) in [(0, 3), (1, 8)] {
        for (lane, index) in [(0, 0), (0, last), (1, 0)] {
            document.model_mut().toggle_vehicle(CellRef {
                street,
                lane,
                index,
            });
        }
    }
    let geometry = document.geometry_snapshot();
    let scene = TrafficScene::from_document(&document);
    let (device, queue) = device();
    let display = TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    display.set_view(
        &queue,
        WorldView {
            origin: scene.shift(),
            span: [36., 14.],
        },
    );
    let image = Target::new(&device).render(&device, &queue, &display, VehicleStyle::Heat);
    for (street, lane, expected) in [
        (0, 0, [255, 220, 40]), // 2 / 4, not 3 / 5.
        (0, 1, [128, 220, 40]), // 1 / 4 in the reverse lane.
        (1, 0, [204, 220, 40]), // 2 / 5 across the seam.
        (1, 1, [102, 220, 40]), // 1 / 5, independent of the other lane.
    ] {
        assert_rgb(
            pixel(&image, geometry.streets[street].centers[lane][0]),
            expected,
        );
    }
}

#[test]
fn heat_squares_use_clipped_same_lane_windows_and_keep_obstacles_unchanged() {
    use ca_core::disruptions::{Disruption, ScenarioAction};
    let mut document = MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":6,"carriles":2,"x":5,"y":10}]}"#,
    )
    .unwrap();
    for (lane, indices) in [(0, vec![0, 2, 5]), (1, vec![0, 1, 2, 3, 4, 5])] {
        for index in indices {
            document.model_mut().toggle_vehicle(CellRef {
                street: 0,
                lane,
                index,
            });
        }
    }
    let geometry = document.geometry_snapshot();
    let mut scene = TrafficScene::from_document(&document);
    scene
        .disrupt(ScenarioAction::Paint(
            CellRef {
                street: 0,
                lane: 0,
                index: 1,
            },
            Disruption::Cone,
        ))
        .unwrap();
    scene.publish_edits();
    scene.set_metric_streets(vec![false]);
    let (device, queue) = device();
    let display = TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    display.set_view(
        &queue,
        WorldView {
            origin: scene.shift(),
            span: [36., 14.],
        },
    );
    let target = Target::new(&device);
    let normal = target.render(&device, &queue, &display, VehicleStyle::Classes);
    let heat = target.render(&device, &queue, &display, VehicleStyle::Heat);
    // [car, cone, car] at the left end; five physical cells in the middle.
    for (index, expected) in [
        (0, [255, 147, 40]),
        (2, [204, 220, 40]),
        (5, [170, 220, 40]),
    ] {
        assert_rgb(
            pixel(&heat, geometry.streets[0].centers[0][index]),
            expected,
        );
    }
    assert_rgb(
        pixel(&heat, geometry.streets[0].centers[1][2]),
        [255, 0, 40],
    );
    let obstacle = geometry.streets[0].centers[0][1];
    assert_eq!(pixel(&heat, obstacle), pixel(&normal, obstacle));
    let center = geometry.streets[0].centers[0][2];
    assert_rgb(
        pixel(&heat, [center[0] - 0.3, center[1] - 0.3]),
        [204, 220, 40],
    );
    assert_ne!(
        pixel(&heat, [center[0] - 0.38, center[1]]),
        pixel(&normal, [center[0] - 0.38, center[1]])
    );
    assert_eq!(
        target.render(&device, &queue, &display, VehicleStyle::Classes),
        normal
    );
}

#[test]
fn colourless_vehicle_shapes_are_tinted_and_face_the_lane_direction() {
    let mut document = MapDocument::parse(
        r#"{"calles":[{"nombre":"Shapes","tipo":"conexion","tamano":30,"carriles":2,"x":5,"y":10,"laneDirections":[1,-1]}]}"#
    ).unwrap();
    document.model_mut().random_fill(1.0).unwrap();
    let geometry = document.geometry_snapshot();
    let scene = TrafficScene::from_document(&document);
    let (device, queue) = device();
    let display = TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    display.set_view(
        &queue,
        WorldView {
            origin: scene.shift(),
            span: [36., 14.],
        },
    );
    let image = Target::new(&device).render(&device, &queue, &display, VehicleStyle::Classes);
    let palette = [
        [242, 46, 43],
        [255, 166, 20],
        [242, 230, 38],
        [31, 217, 89],
        [26, 153, 255],
        [204, 64, 242],
    ];
    let mut shapes = [false; 2];
    for lane in 0..2 {
        for index in 0..30 {
            let id = document.model().streets()[0].vehicle_appearances()[lane * 30 + index];
            let motorcycle = id > 6;
            shapes[usize::from(motorcycle)] = true;
            let center = geometry.streets[0].centers[lane][index];
            let direction = if lane == 0 { 1. } else { -1. };
            // Independent landmark expectations, not a copy of the shader:
            // coloured tank/bonnet ahead; clear road beside a motorcycle.
            let front = if motorcycle { 0.08 } else { 0.25 };
            assert_rgb(
                pixel(&image, [center[0] + direction * front, center[1]]),
                palette[usize::from((id - 1) % 6)],
            );
            assert_rgb(
                pixel(&image, [center[0] - direction * 0.05, center[1] + 0.18]),
                if motorcycle {
                    [22, 26, 33]
                } else {
                    palette[usize::from((id - 1) % 6)].map(|v| (f32::from(v) * 0.75).round() as u8)
                },
            );
        }
    }
    assert_eq!(shapes, [true, true]);
}

// Manual measurement, not a timing gate in CI. Query readback is test-only.
// Alternate modes to limit clock/temperature bias. Measure GPU passes, not CPU
// submit time or monitor refresh rate.
#[test]
#[ignore = "manual GPU timestamp benchmark; requires TIMESTAMP_QUERY"]
fn benchmark_vehicle_styles() {
    use ca_core::traffic::VehicleAction;
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    assert!(adapter.features().contains(wgpu::Features::TIMESTAMP_QUERY));
    println!("Adapter: {:?}", adapter.get_info());
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        required_features: wgpu::Features::TIMESTAMP_QUERY,
        ..Default::default()
    }))
    .unwrap();
    let target = Target::new(&device);
    let roads: Vec<_> = (0..128)
        .map(|row| {
            serde_json::json!({
                "nombre": format!("Stress {row}"), "tipo": "conexion", "tamano": 256,
                "carriles": 2, "x": 0, "y": row * 15
            })
        })
        .collect();
    let stress = MapDocument::parse(&serde_json::json!({"calles": roads}).to_string()).unwrap();
    for (name, document) in [("campus", MapDocument::campus()), ("65536 cells", stress)] {
        let mut scene = TrafficScene::from_document(&document);
        scene.edit_vehicles(VehicleAction::Fill(0.5), true).unwrap();
        let display = TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
        display.set_view(
            &queue,
            WorldView {
                origin: [0.; 2],
                span: scene.extent().map(|v| v as f32),
            },
        );
        let mut samples = [Vec::new(), Vec::new()];
        for round in 0..14 {
            let order = if round % 2 == 0 {
                [VehicleStyle::Classes, VehicleStyle::Heat]
            } else {
                [VehicleStyle::Heat, VehicleStyle::Classes]
            };
            for style in order {
                let times = gpu_times(&device, &queue, &target, &display, style);
                if round >= 2 {
                    samples[usize::from(style == VehicleStyle::Heat)].extend(times);
                }
            }
        }
        let mut medians = [0.; 2];
        for (index, values) in samples.iter_mut().enumerate() {
            values.sort_by(f64::total_cmp);
            medians[index] = values[values.len() / 2];
            println!(
                "{name} {}: median {:.1} us, p95 {:.1} us ({} samples)",
                if index == 0 { "classes" } else { "heat" },
                medians[index],
                values[values.len() * 95 / 100],
                values.len()
            );
        }
        println!(
            "{name}: heat change {:+.1}% ({:+.1} us)",
            (medians[1] / medians[0] - 1.) * 100.,
            medians[1] - medians[0]
        );
    }
}

fn gpu_times(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    target: &Target,
    display: &TrafficDisplay,
    style: VehicleStyle,
) -> Vec<f64> {
    const FRAMES: u32 = 32;
    let queries = device.create_query_set(&wgpu::QuerySetDescriptor {
        label: Some("vehicle style benchmark timestamps"),
        ty: wgpu::QueryType::Timestamp,
        count: FRAMES * 2,
    });
    let bytes = u64::from(FRAMES * 2) * 8;
    let resolve = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("vehicle style resolved timestamps"),
        size: bytes,
        usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let output = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("vehicle style benchmark readback"),
        size: bytes,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&Default::default());
    for frame in 0..FRAMES {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("vehicle style benchmark pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &target.view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            timestamp_writes: Some(wgpu::RenderPassTimestampWrites {
                query_set: &queries,
                beginning_of_pass_write_index: Some(frame * 2),
                end_of_pass_write_index: Some(frame * 2 + 1),
            }),
            ..Default::default()
        });
        display.paint_styled(&mut pass, None, style);
    }
    encoder.resolve_query_set(&queries, 0..FRAMES * 2, &resolve, 0);
    encoder.copy_buffer_to_buffer(&resolve, 0, &output, 0, bytes);
    queue.submit([encoder.finish()]);
    let (tx, rx) = std::sync::mpsc::channel();
    output.map_async(wgpu::MapMode::Read, .., move |result| {
        tx.send(result).unwrap()
    });
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    rx.recv().unwrap().unwrap();
    output
        .slice(..)
        .get_mapped_range()
        .as_chunks::<16>()
        .0
        .iter()
        .map(|pair| {
            let start = u64::from_ne_bytes(pair[..8].try_into().unwrap());
            let end = u64::from_ne_bytes(pair[8..].try_into().unwrap());
            (end - start) as f64 * f64::from(queue.get_timestamp_period()) / 1000.
        })
        .collect()
}
