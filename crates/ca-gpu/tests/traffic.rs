use ca_gpu::TrafficScene;

#[test]
fn building_overlay_draws_the_concavity_and_updates_without_changing_the_document() {
    use ca_core::{
        buildings::{Building, BuildingEdit},
        camera::WorldView,
        map_json::MapDocument,
    };
    let mut map = MapDocument::empty();
    let mut building = Building::polygon(vec![
        [0., 0.],
        [30., 0.],
        [30., 10.],
        [10., 10.],
        [10., 30.],
        [0., 30.],
    ])
    .unwrap();
    building.color = "#123456".into();
    map.add_building(building.clone()).unwrap();
    let mut scene = TrafficScene::from_document(&map);
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let mut display = ca_gpu::TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    let view = WorldView {
        origin: scene.shift(),
        span: [36., 14.],
    };
    display.set_view(&queue, view);
    let before = render_display(&device, &queue, &display);
    assert_eq!(pixel(&before, 1., 5.), [18, 52, 86, 255]);
    assert_eq!(pixel(&before, 4., 4.), [0, 0, 0, 255]);
    let moved = building.moved([40., 0.]);
    display.set_buildings(
        &device,
        &queue,
        &[ca_gpu::building_zone(&moved)],
        scene.shift(),
    );
    let preview = render_display(&device, &queue, &display);
    assert_eq!(pixel(&preview, 1., 5.), [0, 0, 0, 255]);
    assert_eq!(pixel(&preview, 9., 5.), [18, 52, 86, 255]);
    assert_eq!(scene.building_zones()[0].points[0], [0., 0.]);
    scene.edit_buildings(BuildingEdit::Update(0, moved));
    // A later topology/display rebuild retains the committed building geometry.
    display = ca_gpu::TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    display.set_view(&queue, view);
    assert_eq!(
        pixel(&render_display(&device, &queue, &display), 9., 5.),
        [18, 52, 86, 255]
    );
    display.set_buildings(&device, &queue, &[], scene.shift());
    assert_eq!(
        pixel(&render_display(&device, &queue, &display), 9., 5.),
        [0, 0, 0, 255]
    );
}

#[test]
fn a_live_preview_can_hide_only_its_original_street_without_changing_the_scene() {
    use ca_core::{camera::WorldView, map_json::MapDocument};
    let map = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"Preview","tipo":"conexion","tamano":4},
        {"nombre":"Other","tipo":"conexion","tamano":4,"y":20}
    ]}"#,
    )
    .unwrap();
    let scene = TrafficScene::from_document(&map);
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let display = ca_gpu::TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    display.set_view(
        &queue,
        WorldView {
            origin: scene.shift(),
            span: [36.0, 14.0],
        },
    );
    let before = render_display(&device, &queue, &display);
    let preview = render_display_excluding(&device, &queue, &display, Some(0));
    assert!(pixel(&before, 0.5, 0.5)[0] > 10);
    assert!(
        pixel(&preview, 0.5, 0.5)[0] < 10,
        "original footprint is hidden while previewing"
    );
    assert_eq!(
        pixel(&preview, 0.5, 4.5),
        pixel(&before, 0.5, 4.5),
        "other street stays visible"
    );
    assert_eq!(
        render_display(&device, &queue, &display),
        before,
        "cancel restores the original display"
    );
    assert_eq!(
        scene.geometry()[0].centers[0],
        [[2.5, 2.5], [3.5, 2.5], [4.5, 2.5], [5.5, 2.5]]
    );
}

#[test]
fn bezier_display_uses_the_v1_curve_not_the_straight_footprint() {
    use ca_core::{camera::WorldView, cell_index::CellRef, map_json::MapDocument};
    let fixtures: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../ca-core/tests/fixtures/bezier-v1.json")).unwrap();
    let document =
        MapDocument::parse(&serde_json::json!({"calles":[fixtures[0]["street"]]}).to_string())
            .unwrap();
    let mut scene = TrafficScene::from_document(&document);
    let point = &fixtures[0]["centers"][0][11];
    let expected = [
        point[0].as_f64().unwrap() as f32,
        point[1].as_f64().unwrap() as f32,
    ];
    for (axis, value) in expected.iter().enumerate() {
        assert!(
            (scene.geometry()[0].centers[0][11][axis] - scene.shift()[axis] - value).abs() < 0.0001
        );
    }
    scene.toggle_vehicle(
        CellRef {
            street: 0,
            lane: 0,
            index: 11,
        },
        true,
    );
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let display = ca_gpu::TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    display.set_view(
        &queue,
        WorldView {
            origin: scene.shift(),
            span: [36.0, 14.0],
        },
    );
    let bytes = render_display(&device, &queue, &display);
    assert!(
        pixel(&bytes, expected[0], expected[1])[0] > 230,
        "vehicle is on the curve"
    );
    assert!(
        pixel(&bytes, 12.0, 4.0)[0] < 10,
        "old straight footprint is empty"
    );
}

#[test]
fn roundabout_display_uses_circular_centers_and_publishes_wrapped_traffic() {
    use ca_core::{
        camera::WorldView,
        cell_index::CellRef,
        map_json::MapDocument,
        streets::{StreetChange, StreetEdit},
    };
    let map = MapDocument::parse(
        r#"{"calles":[{
        "nombre":"Ring","tipo":"conexion","geometryType":"roundabout",
        "innerRadius":5,"startAngle":-20,"tamano":9,"probabilidadSaltoDeCarril":0
    }]}"#,
    )
    .unwrap();
    let mut scene = TrafficScene::from_document(&map);
    scene.toggle_vehicle(
        CellRef {
            street: 0,
            lane: 0,
            index: 8,
        },
        true,
    );
    scene.tick();
    assert_eq!(scene.cells(), [1, 0, 0, 0, 0, 0, 0, 0, 0]);
    let shift = scene.shift();
    let center = scene.geometry()[0].centers[0][0];
    assert!((center[0] - shift[0] - 1.5).abs() < 0.00001);
    assert!((center[1] - shift[1]).abs() < 0.00001);
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let display = ca_gpu::TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    display.set_view(
        &queue,
        WorldView {
            origin: [shift[0] - 10.0, shift[1] - 7.0],
            span: [36.0, 14.0],
        },
    );
    let bytes = render_display(&device, &queue, &display);
    assert!(
        pixel(&bytes, 11.5, 7.0)[0] > 230,
        "wrapped vehicle at sector zero"
    );
    assert!(
        pixel(&bytes, 10.0, 7.0)[0] < 10,
        "roundabout center is empty"
    );
    assert!(
        pixel(&bytes, 11.5, 5.25)[0] < 10,
        "closed streets have no external endpoint arrows"
    );
    assert!(scene.edit_streets(StreetEdit::Update(0, StreetChange::Radius(2.0))));
    assert_eq!(scene.shift(), shift);
    assert_eq!(
        scene.cells(),
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    );
}

#[test]
fn topology_edits_keep_live_cells_and_display_coordinates() {
    use ca_core::{
        cell_index::CellRef,
        map_json::MapDocument,
        streets::{StreetDraft, StreetEdit},
    };
    let mut scene = TrafficScene::from_document(&MapDocument::demo());
    let shift = scene.shift();
    let center = scene.geometry()[0].centers[0][0];
    let population = scene.population();
    assert!(scene.edit_streets(StreetEdit::Draw(
        StreetDraft::between([-20.0, -20.0], [-17.0, -16.0]).unwrap()
    )));
    assert_eq!(scene.shift(), shift);
    assert_eq!(scene.geometry()[0].centers[0][0], center);
    assert_eq!(scene.population(), population);
    assert_eq!(scene.geometry()[3].centers[0].len(), 5);
    assert!(scene.edit_streets(StreetEdit::Delete(1)));
    assert_eq!(scene.geometry().len(), 3);
    assert!(scene.connection_arrows().is_empty());
    assert!(scene.toggle_vehicle(
        CellRef {
            street: 2,
            lane: 0,
            index: 0
        },
        true
    ));
    scene.tick();
    assert_eq!(scene.geometry()[2].centers[0].len(), 5);
}

#[test]
fn transport_actions_publish_paused_or_on_the_next_tick() {
    use ca_core::traffic::VehicleAction;
    let mut scene = TrafficScene::demo();
    scene.edit_vehicles(VehicleAction::Clear, true).unwrap();
    assert_eq!(scene.population(), 0);
    for index in [18, 82, 146] {
        assert_eq!(scene.cells()[index], 7);
    }
    scene
        .edit_vehicles(VehicleAction::Fill(1.0), false)
        .unwrap();
    assert_eq!(scene.population(), 0);
    assert!(scene.publish_edits());
    assert_eq!(scene.population(), 189);
    scene.edit_vehicles(VehicleAction::Clear, false).unwrap();
    scene.set_generation_override(Some(0.0)).unwrap();
    scene.tick();
    assert_eq!(scene.population(), 0);
    scene.set_generation_override(Some(1.0)).unwrap();
    scene.tick();
    assert_eq!(scene.population(), 2);
    assert!(
        scene
            .edit_vehicles(VehicleAction::Fill(f64::NAN), true)
            .is_err()
    );
}

#[test]
fn cell_edits_publish_immediately_when_paused_and_at_next_tick_when_running() {
    use ca_core::cell_index::CellRef;
    let cell = CellRef {
        street: 1,
        lane: 0,
        index: 8,
    };
    let mut scene = TrafficScene::demo();
    assert!(scene.toggle_vehicle(cell, true));
    assert_eq!(scene.cells()[72], 1);
    assert!(scene.toggle_vehicle(cell, true));
    assert_eq!(scene.cells()[72], 0);
    assert!(scene.toggle_vehicle(cell, false));
    assert_eq!(scene.cells()[72], 0, "running edit waits for the next tick");
    scene.tick();
    assert_eq!(
        scene.cells()[73],
        1,
        "edited car participates in the next tick"
    );
    assert!(!scene.toggle_vehicle(CellRef { street: 99, ..cell }, true));
    assert!(
        !scene.toggle_vehicle(
            CellRef {
                street: 0,
                lane: 0,
                index: 18
            },
            true
        ),
        "special cells are not vehicles"
    );
}

#[test]
fn pausing_before_next_tick_publishes_pending_edits_without_advancing_traffic() {
    let mut scene = TrafficScene::demo();
    scene.toggle_vehicle(
        ca_core::cell_index::CellRef {
            street: 1,
            lane: 0,
            index: 8,
        },
        false,
    );
    assert_eq!(scene.cells()[72], 0);
    assert!(scene.publish_edits());
    assert_eq!(scene.cells()[72], 1);
    assert!(
        !scene.publish_edits(),
        "unchanged paused frames need no upload"
    );
}

#[test]
fn demo_has_physical_lane_positions_and_both_directions() {
    let scene = TrafficScene::demo();
    let lanes = scene.lanes();
    assert_eq!(lanes.len(), 6);
    assert_eq!(lanes[0].origin, [2.0, 2.0]);
    assert_eq!(lanes[1].origin, [2.0, 3.0]);
    assert_eq!(lanes[2].origin, [2.0, 6.0]);
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
    // This test isolates packing from hourly profiles. The clock/profile tests
    // independently cover generation with profiles enabled.
    let mut profiles = ca_core::virtual_time::VirtualTime::default();
    profiles.enabled = false;
    scene.set_profiles(profiles);
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
fn curved_tiles_render_at_v1_centers_and_geometry_edits_preserve_live_traffic() {
    use ca_core::{camera::WorldView, cell_index::CellRef, map_json::MapDocument};
    let mut map = MapDocument::parse(r#"{"calles":[{"nombre":"Curve","tipo":"conexion","tamano":3,"carriles":1,"esCurva":true,"vertices":[{"indiceCelda":0,"anguloOffset":0},{"indiceCelda":2,"anguloOffset":90}]}]}"#).unwrap();
    let mut scene = TrafficScene::from_document(&map);
    scene.toggle_vehicle(
        CellRef {
            street: 0,
            lane: 0,
            index: 2,
        },
        true,
    );
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let display = ca_gpu::TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    let shift = scene.shift();
    display.set_view(
        &queue,
        WorldView {
            origin: [shift[0] - 2.0, shift[1] - 5.0],
            span: [36.0, 14.0],
        },
    );
    let bytes = render_display(&device, &queue, &display);
    // Independent worked integration: step 1 at -45°, step 2 at -90°.
    assert!(
        pixel(&bytes, 2.707107, 2.792893)[0] > 230,
        "vehicle at curved cell 2"
    );
    assert!(
        pixel(&bytes, 4.5, 5.5)[0] < 10,
        "old straight footprint is empty"
    );
    assert!(
        pixel(&bytes, 3.66066, 3.93934)[0] > 15,
        "45-degree footprint follows its tangent"
    );
    assert!(map.set_vertex_offset(0, 1, 0.0));
    assert!(scene.set_vertex_offset(0, 1, 0.0));
    display.upload_street(&queue, &scene, 0);
    assert_eq!(scene.cells(), [0, 0, 1]);
    assert_eq!(
        scene.shift(),
        shift,
        "editing must not move all other map objects"
    );
    let bytes = render_display(&device, &queue, &display);
    assert!(
        pixel(&bytes, 4.5, 5.0)[0] > 230,
        "same car follows the edited curve"
    );
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
    let bytes = render_display(&device, &queue, &display);
    let pixel = |x, y| pixel(&bytes, x, y);
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
    assert!(pixel(1.3, 2.61)[0] > 150);
    assert!(pixel(0.7, 2.61)[0] < 20);
    assert!(pixel(0.7, 3.61)[0] > 150);
    assert!(pixel(1.3, 3.61)[0] < 20);
    assert!(pixel(7.5, 4.5)[0] < 20, "gap between streets");
}

#[test]
fn transformed_display_shows_paused_edits_in_the_first_paint_and_running_edits_after_tick() {
    use ca_core::{camera::WorldView, cell_index::CellRef};
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = match pollster::block_on(instance.request_adapter(&Default::default())) {
        Ok(adapter) => adapter,
        Err(error) => {
            eprintln!("SKIP GPU display test: no adapter: {error}");
            return;
        }
    };
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let mut scene = TrafficScene::demo();
    let display = ca_gpu::TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    display.set_view(
        &queue,
        WorldView {
            origin: [6.0, 1.0],
            span: [18.0, 7.0],
        },
    );
    // World (7.5, 2.5) maps to screen (3, 3) in the test's 36 x 14 units.
    let bytes = render_display(&device, &queue, &display);
    assert!(pixel(&bytes, 3.0, 3.0)[0] > 230);
    let cell = CellRef {
        street: 0,
        lane: 0,
        index: 5,
    };
    scene.toggle_vehicle(cell, true);
    display.upload(&queue, &scene);
    let bytes = render_display(&device, &queue, &display);
    assert!(
        pixel(&bytes, 3.0, 3.0)[0] < 30,
        "paused removal appears in first paint"
    );
    scene.toggle_vehicle(cell, false);
    display.upload(&queue, &scene);
    let bytes = render_display(&device, &queue, &display);
    assert!(
        pixel(&bytes, 3.0, 3.0)[0] < 30,
        "running edit is not packed yet"
    );
    scene.tick();
    display.upload(&queue, &scene);
    let bytes = render_display(&device, &queue, &display);
    assert!(
        pixel(&bytes, 5.0, 3.0)[0] > 230,
        "car advances to physical cell 6"
    );
}

fn pixel(bytes: &[u8], x: f32, y: f32) -> [u8; 4] {
    let offset = (((y * 32.0) as u32 * 1152 + (x * 32.0) as u32) * 4) as usize;
    bytes[offset..offset + 4].try_into().unwrap()
}

fn render_display(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    display: &ca_gpu::TrafficDisplay,
) -> Vec<u8> {
    render_display_excluding(device, queue, display, None)
}

fn render_display_excluding(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    display: &ca_gpu::TrafficDisplay,
    excluded: Option<usize>,
) -> Vec<u8> {
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
        display.paint_background(&mut pass);
        if excluded.is_some() {
            display.paint_excluding(&mut pass, excluded);
        } else {
            display.paint(&mut pass);
        }
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
    output.slice(..).get_mapped_range().to_vec()
}
