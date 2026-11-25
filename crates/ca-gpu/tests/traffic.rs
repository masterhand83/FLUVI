use ca_gpu::TrafficScene;

#[test]
fn demo_has_physical_lane_positions_and_both_directions() {
    let scene = TrafficScene::demo();
    let lanes = scene.lanes();
    assert_eq!(lanes.len(), 6);
    assert_eq!(lanes[0].origin, [2, 2]);
    assert_eq!(lanes[1].origin, [2, 3]);
    assert_eq!(lanes[2].origin, [2, 6]);
    assert_eq!(lanes[0].direction, 1);
    assert_eq!(lanes[1].direction, 0);
    assert_eq!(lanes[2].offset, 64);
    assert_eq!(lanes[2].length, 32);
    assert_eq!(scene.extent(), [36, 14]);
    for value in 1..=7 {
        assert!(scene.cells().contains(&value));
    }
    assert_eq!(scene.population(), 18);
}

#[test]
fn completed_ticks_pack_the_cpu_model_without_changing_physical_indices() {
    let mut scene = TrafficScene::demo();
    let mut oracle = ca_core::traffic::TrafficModel::demo();
    for _ in 0..120 {
        scene.tick();
        oracle.tick();
        let expected: Vec<u32> = oracle
            .streets()
            .iter()
            .flat_map(|s| s.cells().iter().map(|&v| u32::from(v)))
            .collect();
        assert_eq!(scene.cells(), expected);
        assert_eq!(
            scene.population(),
            expected.iter().filter(|&&v| (1..=6).contains(&v)).count() as u32
        );
    }
    assert!(scene.population() > 0);
}

#[test]
fn storage_buffer_display_matches_known_vehicle_colours_and_lane_arrows() {
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = match pollster::block_on(instance.request_adapter(&Default::default())) {
        Ok(adapter) => adapter,
        Err(error) => {
            eprintln!("SKIP GPU display test: no adapter: {error}");
            return;
        }
    };
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let scene = TrafficScene::demo();
    let display = ca_gpu::TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    // 32 pixels per world cell. Row bytes are a multiple of 256.
    let size = wgpu::Extent3d {
        width: 1152,
        height: 448,
        depth_or_array_layers: 1,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("traffic display oracle"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let output = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("traffic display test readback"),
        size: u64::from(size.width * size.height * 4),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let view = texture.create_view(&Default::default());
    let mut encoder = device.create_command_encoder(&Default::default());
    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("traffic display test pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            ..Default::default()
        });
        display.paint(&mut pass);
    }
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &output,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(size.width * 4),
                rows_per_image: None,
            },
        },
        size,
    );
    queue.submit([encoder.finish()]);
    let (tx, rx) = std::sync::mpsc::channel();
    output.map_async(wgpu::MapMode::Read, .., move |result| {
        tx.send(result).unwrap()
    });
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    rx.recv().unwrap().unwrap();
    let bytes = output.slice(..).get_mapped_range();
    let pixel = |x: f32, y: f32| {
        let offset = (((y * 32.0) as u32 * size.width + (x * 32.0) as u32) * 4) as usize;
        <[u8; 4]>::try_from(&bytes[offset..offset + 4]).unwrap()
    };
    // Known initial positions and palette, independent of the packing algorithm.
    for (x, y, expected) in [
        (7.5, 2.5, [242, 46, 43, 255]),
        (16.5, 2.5, [255, 166, 20, 255]),
        (25.5, 2.5, [242, 230, 38, 255]),
        (7.5, 3.5, [31, 217, 89, 255]),
        (16.5, 3.5, [26, 153, 255, 255]),
        (25.5, 3.5, [204, 64, 242, 255]),
    ] {
        let actual = pixel(x, y);
        for channel in 0..4 {
            assert!(
                actual[channel].abs_diff(expected[channel]) <= 1,
                "{x},{y}: {actual:?}"
            );
        }
    }
    assert!(pixel(20.25, 2.6)[0] > 230, "special cell white body");
    assert!(pixel(20.5, 2.5)[0] < 20, "special cell diagonal");
    // Right arrow head in the forward lane, left arrow head in reverse.
    assert!(pixel(1.3, 2.61)[0] > 150);
    assert!(pixel(0.7, 2.61)[0] < 20);
    assert!(pixel(0.7, 3.61)[0] > 150);
    assert!(pixel(1.3, 3.61)[0] < 20);
    assert!(pixel(7.5, 4.5)[0] < 20, "gap between streets");
}
