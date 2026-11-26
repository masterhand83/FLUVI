use ca_core::map_json::MapDocument;
use ca_gpu::{CapturePlan, TrafficScene};

#[test]
fn whole_map_includes_rotated_corner_and_roundabout_edge() {
    // Ring center (10,20), inner radius 2, two lanes: outer edge x=14.
    // Rectangle center (-10,0), size 4x2, 90 degrees: x=-11..-9,y=-2..2.
    let document = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"Ring","tipo":"conexion","tamano":16,"carriles":2,"x":50,"y":100,
         "geometryType":"roundabout","innerRadius":10,"startAngle":0}],
        "edificios":[{"x":-50,"y":0,"width":20,"height":10,"angle":90}]}"#,
    )
    .unwrap();
    let scene = TrafficScene::from_document(&document);
    let plan = CapturePlan::whole_map(&scene).unwrap();
    // v1 padding is 12 saved pixels = 2.4 cell units on each side.
    let origin = std::array::from_fn::<_, 2, _>(|i| plan.view.origin[i] - scene.shift()[i]);
    assert!((origin[0] + 13.4).abs() < 0.001, "{origin:?}");
    assert!((origin[1] + 4.4).abs() < 0.001, "{origin:?}");
    // Tangent square cells may extend slightly beyond the ideal ring.
    assert!(origin[0] + plan.view.span[0] >= 16.4);
    assert!(origin[1] + plan.view.span[1] >= 26.4);
    assert!(plan.pixels.into_iter().all(|n| n <= 2400));
}

#[test]
fn whole_map_uses_v1_padding_scale_and_size_limits_not_background_zone_bounds() {
    let small = TrafficScene::from_document(&MapDocument::parse(
        r##"{"calles":[],"edificios":[{"x":0,"y":0,"width":10,"height":20}],
        "backgroundAreas":[{"x":-10000,"y":-10000,"width":20000,"height":20000,"color":"#555555"}]}"##
    ).unwrap());
    let plan = CapturePlan::whole_map(&small).unwrap();
    assert_eq!(plan.pixels, [272, 352]); // (10+24,20+24) saved pixels at 8x.
    let large = TrafficScene::from_document(
        &MapDocument::parse(
            r#"{"calles":[],"edificios":[{"x":0,"y":0,"width":1000,"height":500}]}"#,
        )
        .unwrap(),
    );
    assert_eq!(CapturePlan::whole_map(&large).unwrap().pixels, [2400, 1228]);
    assert!(
        CapturePlan::whole_map(&TrafficScene::from_document(
            &MapDocument::parse(r#"{"calles":[]}"#).unwrap()
        ))
        .is_none()
    );
}

#[test]
fn polygon_vertices_and_visible_rotated_reference_expand_bounds() {
    let map = |visible| {
        MapDocument::parse(&format!(r#"{{"calles":[],
        "edificios":[{{"geometryType":"polygon","vertices":[{{"x":-20,"y":0}},{{"x":0,"y":0}},{{"x":0,"y":10}}]}}],
        "imagenReferencia":{{"x":100,"y":50,"width":20,"height":10,"rotation":90,"visible":{visible}}}
    }}"#)).unwrap()
    };
    let scene = TrafficScene::from_document(&map(true));
    let plan = CapturePlan::whole_map(&scene).unwrap();
    // Rotated reference corners: x=105..115,y=45..65. Polygon min x=-20.
    let origin: [f32; 2] = std::array::from_fn(|i| plan.view.origin[i] - scene.shift()[i]);
    assert!((origin[0] + 6.4).abs() < 0.001);
    assert!((plan.view.span[0] - 31.8).abs() < 0.001);
    assert!((plan.view.span[1] - 17.8).abs() < 0.001);
    assert_eq!(
        CapturePlan::whole_map(&TrafficScene::from_document(&map(false)))
            .unwrap()
            .pixels,
        [352, 272]
    );
}

#[test]
fn viewport_retains_native_export_resolution_and_rejects_invalid_sizes() {
    let view = ca_core::camera::WorldView {
        origin: [-3., 7.],
        span: [40., 20.],
    };
    assert_eq!(
        CapturePlan::viewport(view, [3840, 2160]).unwrap().pixels,
        [3840, 2160]
    );
    assert!(CapturePlan::viewport(view, [0, 30]).is_none());
    assert!(CapturePlan::viewport(view, [u32::MAX, 30]).is_none());
}

#[test]
fn capture_is_opaque_camera_independent_and_does_not_change_live_display() {
    use ca_core::camera::WorldView;
    use ca_gpu::{Capture, TrafficDisplay, VehicleStyle};
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let scene = TrafficScene::demo();
    let display = TrafficDisplay::new(&device, &scene, wgpu::TextureFormat::Rgba8Unorm);
    let plan = CapturePlan::whole_map(&scene).unwrap();
    let capture = |plan| {
        Capture::start(&device, &queue, &scene, plan, VehicleStyle::Classes, &[])
            .unwrap()
            .read_on_worker(&device)
            .unwrap()
    };
    let live = CapturePlan::viewport(
        WorldView {
            origin: [0.; 2],
            span: [12.; 2],
        },
        [96; 2],
    )
    .unwrap();
    display.set_view(&queue, live.view);
    let before = render_live(&device, &queue, &display);
    let whole_a = capture(plan);
    assert_eq!(before, render_live(&device, &queue, &display));
    display.set_view(
        &queue,
        WorldView {
            origin: [100., -50.],
            span: [1.; 2],
        },
    );
    let moved = render_live(&device, &queue, &display);
    assert_ne!(before, moved);
    let whole_b = capture(plan);
    assert_eq!(whole_a, whole_b);
    assert_eq!(moved, render_live(&device, &queue, &display));
    assert!(whole_a.rgba.as_chunks::<4>().0.iter().all(|p| p[3] == 255));
    assert!(
        whole_a
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .any(|p| *p != [144, 184, 244, 255])
    );
    assert_ne!(capture(live).pixels, whole_a.pixels);
}

fn render_live(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    display: &ca_gpu::TrafficDisplay,
) -> Vec<u8> {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("live view oracle"),
        size: wgpu::Extent3d {
            width: 64,
            height: 64,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let output = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("live view oracle readback"),
        size: 64 * 256,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let view = texture.create_view(&Default::default());
    let mut encoder = device.create_command_encoder(&Default::default());
    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
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
        display.paint(&mut pass);
    }
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &output,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(256),
                rows_per_image: None,
            },
        },
        texture.size(),
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

#[test]
fn viewport_crop_has_known_building_pixels_and_artwork_blends_over_opaque_background() {
    use ca_core::camera::WorldView;
    use ca_gpu::{Capture, CaptureImage, VehicleStyle};
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let document = MapDocument::parse(
        r##"{"calles":[],"edificios":[
        {"x":5,"y":5,"width":10,"height":10,"color":"#ff0000"},
        {"x":15,"y":5,"width":10,"height":10,"color":"#0000ff"}]}"##,
    )
    .unwrap();
    let scene = TrafficScene::from_document(&document);
    let plan = CapturePlan::viewport(
        WorldView {
            origin: [scene.shift()[0] + 2., scene.shift()[1]],
            span: [2., 2.],
        },
        [65, 33],
    )
    .unwrap(); // Deliberately unaligned row width.
    let image = Capture::start(&device, &queue, &scene, plan, VehicleStyle::Classes, &[])
        .unwrap()
        .read_on_worker(&device)
        .unwrap();
    assert_eq!(image.rgba.len(), 65 * 33 * 4);
    let center = (16 * 65 + 32) * 4;
    assert_eq!(&image.rgba[center..center + 4], &[0, 0, 255, 255]);
    let empty = TrafficScene::from_document(&MapDocument::parse(r#"{"calles":[]}"#).unwrap());
    let plan = CapturePlan::viewport(
        WorldView {
            origin: [0.; 2],
            span: [2.; 2],
        },
        [65, 33],
    )
    .unwrap();
    let artwork = CaptureImage {
        building: None,
        corners: [[0., 0.], [2., 0.], [2., 2.], [0., 2.]],
        pixels: [1, 1],
        rgba: vec![0, 255, 0, 128],
        opacity: 0.5,
    };
    let image = Capture::start(
        &device,
        &queue,
        &empty,
        plan,
        VehicleStyle::Classes,
        &[artwork],
    )
    .unwrap()
    .read_on_worker(&device)
    .unwrap();
    // Default 07:00 sky is #90b8f4. Green artwork has effective alpha 128/255 * 0.5.
    for (actual, expected) in image.rgba[center..center + 4]
        .iter()
        .zip([108u8, 202, 183, 255])
    {
        assert!(actual.abs_diff(expected) <= 1);
    }
}
