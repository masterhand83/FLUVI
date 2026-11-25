use ca_core::buildings::{Building, validate_polygon};
use ca_core::map_json::MapDocument;
use serde_json::json;

#[test]
fn concave_polygon_includes_edges_but_not_the_notch() {
    let points = vec![[0., 0.], [6., 0.], [6., 2.], [2., 2.], [2., 6.], [0., 6.]];
    assert_eq!(validate_polygon(&points), Ok(()));
    let building = Building::polygon(points).unwrap();
    assert_eq!(building.center, [2.2, 2.2]);
    for point in [[1., 5.], [5., 1.], [2., 4.], [0., 0.]] {
        assert!(building.contains(point), "{point:?}");
    }
    for point in [[4., 4.], [-1., 1.], [7., 0.]] {
        assert!(!building.contains(point), "{point:?}");
    }
    assert_eq!(building.bounds(), [[0., 0.], [6., 6.]]);
}

#[test]
fn rotated_rectangle_handles_use_the_rotated_local_axes() {
    let mut building = Building::rectangle([10., 20.], [8., 4.]);
    building.angle = 90.;
    let points = building.points();
    for (actual, expected) in points
        .iter()
        .zip([[12., 16.], [12., 24.], [8., 24.], [8., 16.]])
    {
        assert!((actual[0] - expected[0]).abs() < 1e-10);
        assert!((actual[1] - expected[1]).abs() < 1e-10);
    }
    assert!(building.contains([10., 23.]));
    assert!(!building.contains([13., 20.]));
}

#[test]
fn v1_fields_survive_loading_editing_and_saving() {
    let rectangle = json!({"x":10,"y":20,"width":8,"height":4,"angle":90,"label":"A",
        "color":"#123456","esEstacionamiento":true,"capacidad":40,"conexiones":[],
        "vehiculosActuales":3,"futureField":{"value":7}});
    let polygon = json!({"geometryType":"polygon","vertices":[{"x":0,"y":0},{"x":6,"y":0},{"x":2,"y":4}],
        "x":3,"y":2,"width":6,"height":4,"angle":0,"label":"B","color":"#46B5D1",
        "appearanceMode":"color","conexiones":[]});
    let source =
        json!({"version":"1.0","calles":[],"conexiones":[],"edificios":[rectangle,polygon]});
    let mut map = MapDocument::parse(&source.to_string()).unwrap();
    assert_eq!(map.buildings().len(), 2);
    let saved: serde_json::Value = serde_json::from_str(&map.to_json()).unwrap();
    assert_eq!(saved["edificios"], source["edificios"]);
    let mut edited = map.buildings()[0].clone();
    assert_eq!(edited.palette_index(), None);
    edited.label = "Renamed".into();
    map.update_building(0, edited).unwrap();
    let saved: serde_json::Value = serde_json::from_str(&map.to_json()).unwrap();
    assert_eq!(saved["edificios"][0]["futureField"], json!({"value":7}));
    assert_eq!(saved["edificios"][0]["color"], "#123456");
    assert_eq!(saved["edificios"][0]["capacidad"], 40);
    let mut edited = map.buildings()[1].clone();
    edited.label = "Polygon renamed".into();
    map.update_building(1, edited).unwrap();
    let saved: serde_json::Value = serde_json::from_str(&map.to_json()).unwrap();
    let mut expected = source["edificios"][1].clone();
    expected["label"] = json!("Polygon renamed");
    assert_eq!(saved["edificios"][1], expected);
}

#[test]
fn polygon_validation_matches_v1_reasons_and_rejected_edits_are_atomic() {
    for (points, reason) in [
        (vec![[0., 0.], [1., 1.]], "invalid-vertices"),
        (
            vec![[0., 0.], [1., 1.], [0., 0.]],
            "too-few-distinct-vertices",
        ),
        (vec![[0., 0.], [1., 1.], [2., 2.]], "zero-area"),
        (
            vec![[0., 0.], [0., 0.], [4., 0.], [0., 4.]],
            "zero-length-edge",
        ),
        (
            vec![[0., 0.], [4., 4.], [0., 4.], [4., 0.], [5., 2.]],
            "self-intersection",
        ),
    ] {
        assert_eq!(validate_polygon(&points).unwrap_err().0, reason);
    }
    let mut map = MapDocument::empty();
    map.add_building(Building::rectangle([0., 0.], [4., 4.]))
        .unwrap();
    let before = map.to_json();
    let mut invalid = map.buildings()[0].clone();
    invalid.size[0] = 0.;
    assert!(map.update_building(0, invalid).is_err());
    assert_eq!(map.to_json(), before);
}
