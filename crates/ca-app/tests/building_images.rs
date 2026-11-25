use ca_app::building_images::DecodedImage;

const PNG: &[u8] = include_bytes!("../../../apps/v1/assets/images/objects/cono.png");

#[test]
fn decoder_rejects_size_type_and_corrupt_data_before_editing() {
    assert!(DecodedImage::from_bytes(&vec![0; 5 * 1024 * 1024 + 1]).is_err());
    assert!(DecodedImage::from_bytes(b"GIF89a").is_err());
    assert!(DecodedImage::from_bytes(b"\x89PNG\r\n\x1a\nbad").is_err());
    let decoded = DecodedImage::from_bytes(PNG).unwrap();
    assert!(decoded.pixels[0] > 0 && decoded.pixels[1] > 0);
    let restored = DecodedImage::from_data(&decoded.data).unwrap();
    assert_eq!(restored.data, decoded.data);
    assert_eq!(restored.rgba, decoded.rgba);
}

#[test]
fn jpeg_and_webp_uploads_decode_with_their_original_bytes() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    for (format, mime) in [
        (image::ImageFormat::Jpeg, "jpeg"),
        (image::ImageFormat::WebP, "webp"),
    ] {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(4, 2)
            .write_to(&mut bytes, format)
            .unwrap();
        let decoded = DecodedImage::from_bytes(bytes.get_ref()).unwrap();
        assert_eq!(decoded.pixels, [4, 2]);
        assert_eq!(
            decoded.data,
            format!(
                "data:image/{mime};base64,{}",
                STANDARD.encode(bytes.get_ref())
            )
        );
    }
}

#[test]
fn every_campus_artwork_path_is_embedded_and_decodes_on_a_worker() {
    use ca_app::building_images::{self, Source};
    use ca_core::{buildings::artwork, map_json::MapDocument};
    let map = MapDocument::campus();
    let paths: std::collections::HashSet<_> = map
        .buildings()
        .iter()
        .filter_map(|b| b.image_key().and_then(artwork::path))
        .collect();
    assert!(
        paths.len() >= 20,
        "campus artwork must not silently become color buildings"
    );
    for path in paths {
        let rx = building_images::start(Source::Bundled(path), egui::Context::default()).unwrap();
        let decoded = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(decoded.pixels[0] > 0 && decoded.pixels[1] > 0, "{path}");
    }
}

#[test]
fn invalid_replacement_leaves_the_map_and_selection_unchanged() {
    use ca_app::buildings::BuildingEditor;
    use ca_core::{buildings::Building, map_json::MapDocument};
    let mut map = MapDocument::empty();
    map.add_building(Building::rectangle([10., 20.], [80., 40.]))
        .unwrap();
    let before = map.to_json();
    let mut editor = BuildingEditor::default();
    editor.select(Some(0));
    let (tx, rx) = crossbeam_channel::bounded(1);
    editor.begin_image_load(rx, Some(0));
    tx.send(DecodedImage::from_bytes(b"GIF89a").map(Some))
        .unwrap();
    assert!(editor.poll_image(&map).is_none());
    assert_eq!(map.to_json(), before);
    assert_eq!(editor.selected(), Some(0));
    assert_eq!(editor.error().unwrap().0, "imageType");
}

#[test]
fn cancelled_decode_cannot_place_an_image_in_a_replacement_map() {
    use ca_app::buildings::BuildingEditor;
    use ca_core::map_json::MapDocument;
    let mut editor = BuildingEditor::default();
    let (tx, rx) = crossbeam_channel::bounded(1);
    editor.begin_image_load(rx, None);
    editor.cancel();
    assert!(
        tx.try_send(Ok(Some(DecodedImage::from_bytes(PNG).unwrap())))
            .is_err()
    );
    assert!(editor.poll_image(&MapDocument::empty()).is_none());
    assert!(editor.place_image([10., 20.]).is_none());
}

#[test]
fn decoded_upload_places_at_click_and_replace_keeps_selection() {
    use ca_app::buildings::BuildingEditor;
    use ca_core::{buildings::Building, map_json::MapDocument};
    let mut editor = BuildingEditor::default();
    let mut map = MapDocument::empty();
    let (tx, rx) = crossbeam_channel::bounded(1);
    editor.begin_image_load(rx, None);
    tx.send(Ok(Some(DecodedImage::from_bytes(PNG).unwrap())))
        .unwrap();
    assert!(editor.poll_image(&map).is_none());
    map.edit_buildings(editor.place_image([12., 34.]).unwrap())
        .unwrap();
    assert_eq!(map.buildings()[0].center, [12., 34.]);
    assert_eq!(
        map.buildings()[0].size.iter().copied().fold(0., f64::max),
        120.
    );
    let mut legacy = Building::from_json(&serde_json::json!({
        "label":"ESCOM","x":5,"y":7,"width":10,"height":20,"angle":90
    }))
    .unwrap();
    legacy.label = "Name".into();
    map.update_building(0, legacy).unwrap();
    editor.select(Some(0));
    let (tx, rx) = crossbeam_channel::bounded(1);
    editor.begin_image_load(rx, Some(0));
    tx.send(Ok(Some(DecodedImage::from_bytes(PNG).unwrap())))
        .unwrap();
    map.edit_buildings(editor.poll_image(&map).unwrap())
        .unwrap();
    assert_eq!(editor.selected(), Some(0));
    assert_eq!(map.buildings()[0].center, [5., 7.]);
    assert_eq!(map.buildings()[0].angle, 90.);
    assert_eq!(map.buildings()[0].label, "Name");
    assert_eq!(
        map.buildings()[0].to_json()["imageRotationConvention"],
        "legacy"
    );
}

#[test]
fn bundled_image_is_decoded_off_thread_and_painted_with_legacy_rotation() {
    use ca_app::buildings::BuildingEditor;
    use ca_core::{buildings::Building, camera::WorldView, map_json::MapDocument};
    use eframe::egui;
    let ctx = egui::Context::default();
    let (wake_tx, wake_rx) = crossbeam_channel::unbounded();
    ctx.set_request_repaint_callback(move |_| {
        let _ = wake_tx.try_send(());
    });
    let mut map = MapDocument::empty();
    map.add_building(
        Building::from_json(&serde_json::json!({
            "label":"ESCOM","x":100,"y":100,"width":80,"height":40,"angle":90
        }))
        .unwrap(),
    )
    .unwrap();
    let mut editor = BuildingEditor::default();
    let rect = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(200., 200.));
    let mut painted = None;
    for _ in 0..30 {
        let output = ctx.run(egui::RawInput::default(), |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                editor.paint(
                    ui,
                    &map,
                    rect,
                    WorldView {
                        origin: [0., 0.],
                        span: [40., 40.],
                    },
                    [0.; 2],
                );
            });
        });
        painted = output
            .shapes
            .into_iter()
            .find_map(|shape| match shape.shape {
                egui::Shape::Mesh(mesh) => Some(mesh),
                _ => None,
            });
        if painted.is_some() {
            break;
        }
        wake_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("image worker repaint");
    }
    let mesh = painted.expect("bundled texture mesh");
    assert_eq!(mesh.indices, [0, 1, 2, 0, 2, 3]);
    for (vertex, expected) in mesh.vertices.iter().zip([
        ([80., 140.], [0., 0.]),
        ([80., 60.], [1., 0.]),
        ([120., 60.], [1., 1.]),
        ([120., 140.], [0., 1.]),
    ]) {
        assert!((vertex.pos.x - expected.0[0]).abs() < 0.001);
        assert!((vertex.pos.y - expected.0[1]).abs() < 0.001);
        assert_eq!(vertex.uv, egui::pos2(expected.1[0], expected.1[1]));
    }
}

#[test]
fn legacy_image_rotation_handle_follows_the_pointer() {
    use ca_app::buildings::{BuildingEditor, Handle};
    use ca_core::{buildings::Building, map_json::MapDocument};
    let mut map = MapDocument::empty();
    map.add_building(
        Building::from_json(&serde_json::json!({
            "label":"ESCOM","x":0,"y":0,"width":80,"height":40,"angle":0
        }))
        .unwrap(),
    )
    .unwrap();
    let mut editor = BuildingEditor::default();
    editor.begin_drag(&map, 0, Handle::Rotate, [0., -40.]);
    editor.drag_to([40., 0.], false);
    map.edit_buildings(editor.finish_drag().unwrap()).unwrap();
    assert_eq!(map.buildings()[0].angle, -90.);
    assert_eq!(map.buildings()[0].display_angle(), 90.);
}
