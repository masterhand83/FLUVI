use ca_app::capture::{encode_png, file_name};
use ca_gpu::CapturedImage;

#[test]
fn png_has_expected_pixels_and_v1_utc_file_name() {
    assert_eq!(
        file_name(0).unwrap(),
        "captura_pantalla_1970-01-01T00-00-00-000Z.png"
    );
    assert_eq!(
        file_name(1_704_164_645_006).unwrap(),
        "captura_pantalla_2024-01-02T03-04-05-006Z.png"
    );
    let original = CapturedImage {
        pixels: [2, 1],
        rgba: vec![255, 0, 0, 255, 0, 128, 255, 255],
    };
    let png = encode_png(&original).unwrap();
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    let decoded = image::load_from_memory(&png).unwrap().into_rgba8();
    assert_eq!(decoded.dimensions(), (2, 1));
    assert_eq!(decoded.into_raw(), original.rgba);
    assert!(
        encode_png(&CapturedImage {
            pixels: [2, 1],
            rgba: vec![]
        })
        .is_err()
    );
}

#[test]
fn viewport_capture_rebases_the_camera_and_draws_linked_reference_pixels() {
    use ca_app::capture::{Snapshot, capture_viewport};
    use ca_core::{camera::WorldView, map_json::MapDocument};
    use eframe::wgpu;
    use std::io::{Read, Write};
    let png = encode_png(&CapturedImage {
        pixels: [1, 1],
        rgba: vec![255, 0, 255, 255],
    })
    .unwrap();
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = server.local_addr().unwrap();
    let serving = std::thread::spawn(move || {
        let (mut stream, _) = server.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut request = [0; 4096];
        let _ = stream.read(&mut request).unwrap();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            png.len()
        )
        .unwrap();
        stream.write_all(&png).unwrap();
    });
    let document = MapDocument::parse(&format!(
        r#"{{"calles":[],
        "imagenReferencia":{{"url":"http://{address}/image.png","x":0,"y":0,
        "width":10,"height":10,"visible":true,"opacity":1}}
    }}"#
    ))
    .unwrap();
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    let image = capture_viewport(
        Snapshot {
            document,
            shift: [100., 200.],
            style: Default::default(),
            device,
            queue,
        },
        WorldView {
            origin: [100., 200.],
            span: [2.; 2],
        },
        [17, 13],
    )
    .unwrap();
    assert_eq!(image.pixels, [17, 13]);
    assert!(
        image
            .rgba
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| *p == [255, 0, 255, 255])
    );
    serving.join().unwrap();
}

#[test]
fn reference_capture_accepts_svg_gif_and_large_png_without_building_upload_restrictions() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use ca_app::capture::{Snapshot, capture_viewport};
    use ca_core::{camera::WorldView, map_json::MapDocument};
    use eframe::wgpu;
    let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#00ff00"/></svg>"##;
    let mut gif = Vec::new();
    image::codecs::gif::GifEncoder::new(&mut gif)
        .encode(&[0, 255, 0, 255], 1, 1, image::ExtendedColorType::Rgba8)
        .unwrap();
    let mut large_png = Vec::new();
    image::ImageEncoder::write_image(
        image::codecs::png::PngEncoder::new_with_quality(
            &mut large_png,
            image::codecs::png::CompressionType::Uncompressed,
            image::codecs::png::FilterType::NoFilter,
        ),
        &[0, 255, 0, 255].repeat(1600 * 1000),
        1600,
        1000,
        image::ExtendedColorType::Rgba8,
    )
    .unwrap();
    assert!(large_png.len() > 5 * 1024 * 1024);
    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::from_env_or_default());
    let adapter = pollster::block_on(instance.request_adapter(&Default::default())).unwrap();
    let (device, queue) = pollster::block_on(adapter.request_device(&Default::default())).unwrap();
    for (mime, bytes) in [
        ("svg+xml", svg.as_slice()),
        ("gif", gif.as_slice()),
        ("png", large_png.as_slice()),
    ] {
        let document = MapDocument::parse(&format!(
            r#"{{"calles":[],
            "imagenReferencia":{{"dataUrl":"data:image/{mime};base64,{}","x":0,"y":0,
            "width":10,"height":10,"visible":true,"opacity":1}}
        }}"#,
            STANDARD.encode(bytes)
        ))
        .unwrap();
        let image = capture_viewport(
            Snapshot {
                document,
                shift: [0.; 2],
                style: Default::default(),
                device: device.clone(),
                queue: queue.clone(),
            },
            WorldView {
                origin: [0.; 2],
                span: [2.; 2],
            },
            [17, 13],
        )
        .unwrap();
        assert!(
            image
                .rgba
                .as_chunks::<4>()
                .0
                .iter()
                .all(|p| *p == [0, 255, 0, 255]),
            "{mime}"
        );
    }
}
