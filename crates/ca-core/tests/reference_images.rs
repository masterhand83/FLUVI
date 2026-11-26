use ca_core::map_json::MapDocument;
use serde_json::json;

#[test]
fn reference_edits_keep_v1_fields_and_local_and_linked_placement() {
    let mut map = MapDocument::empty();
    let mut corners = None;
    for source in [
        json!({"dataUrl":"data:image/png;base64,AQ=="}),
        json!({"url":"https://example.test/map.png"}),
    ] {
        let mut image = json!({
            "x":10,"y":20,"width":100,"height":50,"rotation":90,
            "visible":false,"locked":true,"opacity":0.4
        });
        image
            .as_object_mut()
            .unwrap()
            .extend(source.as_object().unwrap().clone());
        map.set_reference_image(Some(image.clone())).unwrap();
        let reference = map.reference_image().unwrap();
        assert!(!reference.visible);
        assert!(reference.locked);
        assert_eq!(reference.opacity, 0.4);
        if let Some(expected) = corners {
            assert_eq!(reference.corners, expected);
        }
        corners = Some(reference.corners);
        let saved: serde_json::Value = serde_json::from_str(&map.to_json()).unwrap();
        assert_eq!(saved["imagenReferencia"], image);
        let loaded = MapDocument::parse(&map.to_json()).unwrap();
        assert_eq!(loaded.reference_image().unwrap().corners, reference.corners);
    }
    let corner = corners.unwrap()[0];
    assert!((corner[0] - 85.).abs() < 1e-10);
    assert!((corner[1] + 5.).abs() < 1e-10);
    map.set_reference_image(None).unwrap();
    assert!(map.reference_image().is_none());
}

#[test]
fn reference_edits_accept_legacy_clamped_opacity_and_reject_invalid_geometry_atomically() {
    let mut map = MapDocument::empty();
    let image = json!({"width":100.,"height":50.,"opacity":2.,"url":"https://example.test/image"});
    map.set_reference_image(Some(image.clone())).unwrap();
    assert_eq!(map.reference_image().unwrap().opacity, 1.);
    let mut invalid = image.clone();
    invalid["width"] = (-1.).into();
    assert!(map.set_reference_image(Some(invalid)).is_err());
    assert_eq!(map.reference_image_json(), Some(&image));
}
