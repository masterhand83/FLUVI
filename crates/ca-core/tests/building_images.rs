use ca_core::{buildings::Building, map_json::MapDocument};
use serde_json::json;

#[test]
fn embedded_data_round_trips_and_replacing_legacy_art_keeps_placement() {
    let data = "data:image/png;base64,AAECAw==";
    let mut map = MapDocument::empty();
    let building = Building::from_json(&json!({
        "x":10,"y":20,"width":80,"height":40,"angle":30,"label":"ESCOM"
    }))
    .unwrap();
    map.add_building(building).unwrap();
    let mut building = map.buildings()[0].clone();
    building.replace_image(data.into(), [400, 200]).unwrap();
    assert_eq!(building.size, [120., 60.]);
    assert_eq!(building.center, [10., 20.]);
    assert_eq!(building.angle, 30.);
    assert_eq!(building.to_json()["imageRotationConvention"], "legacy");
    map.update_building(0, building).unwrap();
    let saved = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(saved.buildings()[0].to_json()["imageData"], data);
}

#[test]
fn renaming_bundled_art_retains_identity_and_negative_rotation() {
    let mut building = Building::from_json(&json!({
        "x":0,"y":0,"width":80,"height":40,"angle":90,"label":"ESCOM"
    }))
    .unwrap();
    building.label = "Renamed".into();
    let saved = building.to_json();
    assert_eq!(saved["imagen"], "ESCOM");
    let reloaded = Building::from_json(&saved).unwrap();
    assert_eq!(reloaded.image_key(), Some("ESCOM"));
    let corners = reloaded.corners();
    assert!((corners[0][0] + 20.).abs() < 1e-8);
    assert!((corners[0][1] - 40.).abs() < 1e-8);
}

#[test]
fn image_corner_resize_is_proportional_even_with_square_lock() {
    let mut building = Building::rectangle([0., 0.], [1., 1.]);
    building
        .replace_image("data:image/png;base64,AA==".into(), [200, 100])
        .unwrap();
    let resized = building.resized_corner(2, [180., 20.], true).unwrap();
    assert_eq!(resized.size, [240., 120.]);
    assert_eq!(resized.corners()[0], [-60., -30.]);
    assert_eq!(resized.center, [60., 30.]);
}
