use ca_app::reference_images::{self, Source};
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::Duration,
};

#[test]
fn locked_images_ignore_drags_and_resize_keeps_rotated_opposite_corner() {
    use reference_images::{Gesture, Handle};
    let mut image = serde_json::json!({"x":10.,"y":20.,"width":100.,"height":50.,"rotation":90.,"locked":true,"visible":true,"opacity":0.7,"url":"https://example.test/map.png"});
    assert!(Gesture::begin(&image, Handle::Move, [0., 0.]).is_none());
    image["locked"] = false.into();
    let moved = Gesture::begin(&image, Handle::Move, [10., 20.])
        .unwrap()
        .update([20., 40.]);
    assert_eq!(moved["x"], 20.);
    assert_eq!(moved["y"], 40.);
    let resized = Gesture::begin(&image, Handle::Corner(2), [35., 95.])
        .unwrap()
        .update([-15., 195.]);
    assert_eq!(resized["width"], 200.);
    assert_eq!(resized["height"], 100.);
    assert_eq!(resized["x"], -65.);
    assert_eq!(resized["y"], 45.);
    let rotated = Gesture::begin(&image, Handle::Rotate, [60., -5.])
        .unwrap()
        .update([110., 45.]);
    assert!((rotated["rotation"].as_f64().unwrap() - 180.).abs() < 1e-10);
}

#[test]
fn linked_worker_keeps_pixels_and_reports_download_failure_without_ui_work() {
    let png = ca_app::capture::encode_png(&ca_gpu::CapturedImage {
        pixels: [1, 1],
        rgba: vec![255, 0, 0, 255],
    })
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/image", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 2048];
        assert!(stream.read(&mut request).unwrap() > 0);
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            png.len()
        )
        .unwrap();
        stream.write_all(&png).unwrap();
    });
    let job = reference_images::start(Source::Url(url), egui::Context::default()).unwrap();
    let image = job
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(image.image.pixels, [1, 1]);
    assert_eq!(image.image.rgba, [255, 0, 0, 255]);
    server.join().unwrap();
    let job = reference_images::start(
        Source::Url("http://127.0.0.1:0/missing".into()),
        egui::Context::default(),
    )
    .unwrap();
    assert!(job.recv_timeout(Duration::from_secs(5)).unwrap().is_err());
}

#[test]
fn failed_link_keeps_saved_settings_and_new_map_resets_the_editor() {
    use ca_app::{
        map_session::{MapSession, ResetPhase},
        reference_images::{Editor, Status},
    };
    use ca_core::{camera::WorldView, map_json::MapDocument};
    let mut document = MapDocument::empty();
    let saved = serde_json::json!({"x":17.,"y":23.,"width":100.,"height":50.,"rotation":37.,"locked":true,"visible":true,"opacity":0.4,"url":"http://127.0.0.1:0/missing"});
    document.set_reference_image(Some(saved.clone())).unwrap();
    let mut session = MapSession::new(document);
    session.register_reset(ResetPhase::Tools, |editor: &mut Editor| {
        *editor = Editor::default()
    });
    let mut editor = Editor::default();
    let ctx = egui::Context::default();
    let view = WorldView {
        origin: [0.; 2],
        span: [100.; 2],
    };
    editor.update(&ctx, session.document(), view, [0.; 2]);
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while editor.status() == Status::Loading {
        assert!(
            std::time::Instant::now() < deadline,
            "UI worker did not finish"
        );
        std::thread::yield_now();
        editor.update(&ctx, session.document(), view, [0.; 2]);
    }
    assert_eq!(editor.status(), Status::Unavailable);
    let shell = ca_app::shell::Shell::load(None);
    let output = ctx.run(egui::RawInput::default(), |ctx| {
        egui::CentralPanel::default().show(ctx, |ui| {
            editor.paint_controls(
                ui.painter(),
                &shell,
                session.document(),
                egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(500., 500.)),
                view,
                [0.; 2],
            );
        });
    });
    assert!(
        output
            .shapes
            .iter()
            .any(|shape| matches!(&shape.shape, egui::Shape::Text(text)
        if text.galley.text().contains("Enlace de imagen roto")))
    );
    assert_eq!(session.document().reference_image_json(), Some(&saved));
    let reloaded = MapDocument::parse(&session.document().to_json()).unwrap();
    assert_eq!(reloaded.reference_image_json(), Some(&saved));
    assert!(session.replace(true, MapDocument::empty(), &mut editor));
    assert!(session.document().reference_image().is_none());
    assert_eq!(editor.status(), Status::Empty);
}

#[test]
fn linked_reads_time_out_without_waiting_for_the_server() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/slow", listener.local_addr().unwrap());
    let (release, wait) = std::sync::mpsc::channel::<()>();
    let server = std::thread::spawn(move || {
        let (_stream, _) = listener.accept().unwrap();
        let _ = wait.recv_timeout(Duration::from_secs(3));
    });
    let start = std::time::Instant::now();
    assert!(reference_images::download(&url, Duration::from_millis(100)).is_err());
    assert!(start.elapsed() < Duration::from_secs(2));
    drop(release);
    server.join().unwrap();
}

#[test]
fn reference_codec_and_file_worker_enforce_input_limits_and_embed_local_data() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let png = ca_app::capture::encode_png(&ca_gpu::CapturedImage {
        pixels: [2, 1],
        rgba: vec![10, 20, 30, 255, 40, 50, 60, 255],
    })
    .unwrap();
    let path = std::env::temp_dir().join(format!("fluvi-reference-{}.png", std::process::id()));
    std::fs::write(&path, &png).unwrap();
    let job =
        reference_images::start(Source::File(path.clone()), egui::Context::default()).unwrap();
    let loaded = job
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap()
        .unwrap();
    std::fs::remove_file(path).unwrap();
    assert_eq!(loaded.image.pixels, [2, 1]);
    assert_eq!(
        loaded.data_url.unwrap(),
        format!("data:image/png;base64,{}", STANDARD.encode(png))
    );
    assert!(
        reference_images::codec::decode(&vec![0; reference_images::codec::MAX_BYTES as usize + 1])
            .is_err()
    );
    assert!(reference_images::download("file:///etc/passwd", Duration::from_secs(1)).is_err());
}

#[test]
fn native_pointer_drag_previews_before_release_and_locked_image_does_not_capture() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use ca_app::reference_images::{Editor, Status};
    use ca_core::{camera::WorldView, map_json::MapDocument};
    let png = ca_app::capture::encode_png(&ca_gpu::CapturedImage {
        pixels: [1, 1],
        rgba: vec![255; 4],
    })
    .unwrap();
    let mut document = MapDocument::empty();
    let mut image = serde_json::json!({"x":10.,"y":20.,"width":100.,"height":50.,"rotation":0.,"locked":true,
        "dataUrl":format!("data:image/png;base64,{}",STANDARD.encode(png))});
    document.set_reference_image(Some(image.clone())).unwrap();
    let ctx = egui::Context::default();
    let mut editor = Editor::default();
    let view = WorldView {
        origin: [0.; 2],
        span: [100.; 2],
    };
    let rect = egui::Rect::from_min_size(egui::pos2(20., 20.), egui::vec2(500., 500.));
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        editor.update(&ctx, &document, view, [0.; 2]);
        if editor.status() == Status::Ready {
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::yield_now();
    }
    let button = |pos, pressed| egui::Event::PointerButton {
        pos,
        button: egui::PointerButton::Primary,
        pressed,
        modifiers: egui::Modifiers::NONE,
    };
    let run = |editor: &mut Editor, document: &MapDocument, events| {
        let mut captures = false;
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(800., 800.),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    captures = editor.captures(ctx, document, rect, view, [0.; 2]);
                    ui.allocate_rect(rect, egui::Sense::click_and_drag());
                    editor.input(ui, document, rect, view, [0.; 2], true);
                    editor.paint(ui.painter(), document, rect, view, [0.; 2]);
                });
            },
        );
        (captures, output)
    };
    run(&mut editor, &document, vec![]);
    let first = run(&mut editor, &document, vec![])
        .1
        .shapes
        .into_iter()
        .find_map(|shape| {
            if let egui::Shape::Mesh(mesh) = shape.shape {
                Some(mesh)
            } else {
                None
            }
        })
        .unwrap();
    let second = run(&mut editor, &document, vec![])
        .1
        .shapes
        .into_iter()
        .find_map(|shape| {
            if let egui::Shape::Mesh(mesh) = shape.shape {
                Some(mesh)
            } else {
                None
            }
        })
        .unwrap();
    assert!(
        std::sync::Arc::ptr_eq(&first, &second),
        "unchanged frames reuse the mesh"
    );
    let start = egui::pos2(80., 65.);
    let end = egui::pos2(100., 75.);
    assert!(
        !run(
            &mut editor,
            &document,
            vec![egui::Event::PointerMoved(start), button(start, true)]
        )
        .0
    );
    run(
        &mut editor,
        &document,
        vec![egui::Event::PointerMoved(end), button(end, false)],
    );
    assert!(editor.pending().is_none());
    image["locked"] = false.into();
    document.set_reference_image(Some(image)).unwrap();
    assert!(
        run(
            &mut editor,
            &document,
            vec![egui::Event::PointerMoved(start), button(start, true)]
        )
        .0
    );
    let output = run(&mut editor, &document, vec![egui::Event::PointerMoved(end)]).1;
    assert!(editor.pending().is_none(), "saved state waits for release");
    assert_eq!(document.reference_image_json().unwrap()["x"], 10.);
    assert!(
        output
            .shapes
            .iter()
            .any(|shape| matches!(&shape.shape, egui::Shape::Mesh(mesh)
        if mesh.vertices.first().is_some_and(|v| v.pos.distance(egui::pos2(50.,50.)) < 1e-4)))
    );
    run(&mut editor, &document, vec![button(end, false)]);
    let committed = editor.pending().unwrap().as_ref().unwrap();
    assert!((committed["x"].as_f64().unwrap() - 30.).abs() < 1e-5);
    assert!((committed["y"].as_f64().unwrap() - 30.).abs() < 1e-5);
}

#[test]
fn new_link_fits_natural_aspect_ratio_but_replacement_keeps_saved_bounds() {
    use ca_app::reference_images::{Editor, Status};
    use ca_core::{camera::WorldView, map_json::MapDocument};
    let png = ca_app::capture::encode_png(&ca_gpu::CapturedImage {
        pixels: [1, 1],
        rgba: vec![255; 4],
    })
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/square", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 2048];
            assert!(stream.read(&mut request).unwrap() > 0);
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                png.len()
            )
            .unwrap();
            stream.write_all(&png).unwrap();
        }
    });
    let view = WorldView {
        origin: [0.; 2],
        span: [100.; 2],
    };
    for replacement in [false, true] {
        let mut document = MapDocument::empty();
        if replacement {
            document
                .set_reference_image(Some(serde_json::json!({
                    "x":17.,"y":23.,"width":100.,"height":50.,"rotation":37.,
                    "opacity":0.4,"locked":true,"visible":true,"url":"https://old.test/image"
                })))
                .unwrap();
        }
        let mut editor = Editor::default();
        let ctx = egui::Context::default();
        editor.link(&url, &document, view, [0.; 2]).unwrap();
        document
            .set_reference_image(editor.pending().unwrap().clone())
            .unwrap();
        editor.committed();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            editor.update(&ctx, &document, view, [0.; 2]);
            if editor.status() != Status::Loading {
                break;
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::yield_now();
        }
        assert_eq!(editor.status(), Status::Ready);
        if let Some(pending) = editor.pending() {
            document.set_reference_image(pending.clone()).unwrap();
        }
        let image = document.reference_image_json().unwrap();
        if replacement {
            assert_eq!(image["width"], 100.);
            assert_eq!(image["height"], 50.);
            assert_eq!(image["x"], 17.);
            assert_eq!(image["rotation"], 37.);
            assert_eq!(image["locked"], true);
            assert_eq!(image["opacity"], 0.4);
        } else {
            assert_eq!(image["width"], 400.);
            assert_eq!(image["height"], 400.);
            assert_eq!(image["x"], 50.);
            assert_eq!(image["y"], 50.);
        }
    }
    server.join().unwrap();
}

#[test]
fn linked_worker_rejects_oversized_bodies_and_excess_redirects() {
    for redirects in [false, true] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/image", listener.local_addr().unwrap());
        let next = url.clone();
        let server = std::thread::spawn(move || {
            for _ in 0..if redirects { 4 } else { 1 } {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = [0; 2048];
                assert!(stream.read(&mut request).unwrap() > 0);
                if redirects {
                    write!(stream,"HTTP/1.1 302 Found\r\nLocation: {next}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
                } else {
                    let bytes = reference_images::codec::MAX_BYTES + 1;
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {bytes}\r\nConnection: close\r\n\r\n"
                    )
                    .unwrap();
                    let _ = stream.write_all(&vec![0; bytes as usize]);
                }
            }
        });
        assert!(reference_images::download(&url, Duration::from_secs(5)).is_err());
        server.join().unwrap();
    }
}

#[test]
fn pending_download_does_not_block_ui_or_restore_an_image_after_new_map() {
    use ca_app::{
        map_session::{MapSession, ResetPhase},
        reference_images::{Editor, Status},
    };
    use ca_core::{camera::WorldView, map_json::MapDocument};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/pending", listener.local_addr().unwrap());
    let (accepted, request) = std::sync::mpsc::channel();
    let (release, wait) = std::sync::mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = [0; 2048];
        assert!(stream.read(&mut bytes).unwrap() > 0);
        accepted.send(()).unwrap();
        wait.recv_timeout(Duration::from_secs(5)).unwrap();
        let _ = stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
    let mut document = MapDocument::empty();
    document
        .set_reference_image(Some(
            serde_json::json!({"x":1.,"y":2.,"width":100.,"height":50.,"url":url}),
        ))
        .unwrap();
    let mut session = MapSession::new(document);
    session.register_reset(ResetPhase::Tools, |editor: &mut Editor| {
        *editor = Editor::default()
    });
    let mut editor = Editor::default();
    let ctx = egui::Context::default();
    let view = WorldView {
        origin: [0.; 2],
        span: [100.; 2],
    };
    editor.update(&ctx, session.document(), view, [0.; 2]);
    request.recv_timeout(Duration::from_secs(5)).unwrap();
    // The server cannot finish until after this UI call and the map reset.
    editor.update(&ctx, session.document(), view, [0.; 2]);
    assert_eq!(editor.status(), Status::Loading);
    session.replace(true, MapDocument::empty(), &mut editor);
    release.send(()).unwrap();
    server.join().unwrap();
    editor.update(&ctx, session.document(), view, [0.; 2]);
    assert_eq!(editor.status(), Status::Empty);
    assert!(editor.pending().is_none());
    assert!(session.document().reference_image().is_none());
}
