use ca_core::map_json::MapDocument;
use ca_gpu::TrafficScene;

#[test]
fn image_buildings_do_not_have_an_opaque_color_underlay() {
    let image = ca_core::buildings::Building::from_json(&serde_json::json!({
        "label":"ESCOM","width":80,"height":40,"angle":90
    }))
    .unwrap();
    let zone = ca_gpu::building_zone(&image);
    assert_eq!(zone.color[3], 0);
    assert!(!zone.show_border);
}

#[test]
fn building_only_map_fits_saved_pixel_geometry() {
    let document = MapDocument::parse(
        r##"{"version":"1.0","calles":[],"conexiones":[],"edificios":[
        {"x":100,"y":200,"width":40,"height":20,"angle":0,"label":"Only","color":"#123456"}
    ]}"##,
    )
    .unwrap();
    let scene = TrafficScene::from_document(&document);
    assert_eq!(scene.shift(), [-14., -36.]);
    assert_eq!(scene.extent(), [12, 8]);
}

#[test]
fn concave_building_mesh_covers_twenty_square_pixels_without_filling_the_notch() {
    let building = ca_core::buildings::Building::polygon(vec![
        [0., 0.],
        [6., 0.],
        [6., 2.],
        [2., 2.],
        [2., 6.],
        [0., 6.],
    ])
    .unwrap();
    let zone = ca_gpu::building_zone(&building);
    let triangles = ca_gpu::triangulate_polygon(&zone.points);
    assert_eq!(triangles.len(), 12);
    let mut area = 0.;
    for indices in triangles.as_chunks::<3>().0 {
        let [a, b, c] = [
            zone.points[indices[0] as usize],
            zone.points[indices[1] as usize],
            zone.points[indices[2] as usize],
        ];
        area += ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).abs() / 2.;
    }
    // L shape: 6×2 + 2×4 = 20 px², divided by 5² for world units.
    assert!((area - 0.8_f32).abs() < 1e-6);
}
