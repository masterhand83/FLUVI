use ca_core::map_json::MapDocument;
use serde_json::Value;

#[test]
fn campus_matches_the_independent_v1_export_and_curve_samples() {
    let map = MapDocument::campus();
    let baseline: Value =
        serde_json::from_str(include_str!("fixtures/campus-baseline.json")).unwrap();
    assert_eq!(map.model().streets().len(), 85);
    assert_eq!(
        map.model()
            .streets()
            .iter()
            .map(|s| s.cells().len())
            .sum::<usize>(),
        8425
    );
    assert_eq!(map.model().connections().len(), 203);
    for (i, street) in map.model().streets().iter().enumerate() {
        assert_eq!(
            street.config().carriles,
            baseline["streets"][i]["lanes"].as_u64().unwrap() as usize
        );
        assert_eq!(
            street.config().tamano,
            baseline["streets"][i]["length"].as_u64().unwrap() as usize
        );
    }
    let geometry = map.geometry();
    for sample in baseline["samples"].as_array().unwrap() {
        let s = sample["street"].as_u64().unwrap() as usize;
        let l = sample["lane"].as_u64().unwrap() as usize;
        let i = sample["index"].as_u64().unwrap() as usize;
        let actual = geometry[s].centers[l][i];
        assert!(
            (map.layout()[s].angle_at(i) - sample["angulo"].as_f64().unwrap()).abs() < 1e-9,
            "street {s}, cell {i}: tangent differs from v1"
        );
        for (axis, key) in ["x", "y"].iter().enumerate() {
            assert!(
                (actual[axis] as f64 * 5.0 - sample[key].as_f64().unwrap()).abs() < 0.002,
                "street {s}, lane {l}, cell {i}: {actual:?}"
            );
        }
    }
}

#[test]
fn vertex_edit_moves_indexed_cells_and_survives_save_load() {
    use ca_core::cell_index::{CellIndex, CellRef};
    let mut map = MapDocument::parse(r#"{"calles":[{"nombre":"Curve","tipo":"conexion","tamano":21,"carriles":1,"x":0,"y":0}],"conexiones":[]}"#).unwrap();
    assert_eq!(
        map.layout()[0]
            .vertices
            .iter()
            .map(|v| v.index)
            .collect::<Vec<_>>(),
        [0, 10, 20]
    );
    let mut index = CellIndex::new(1.0);
    assert_eq!(index.sync(&map.geometry()), 1);
    assert!(map.set_vertex_offset(0, 1, 90.0));
    let geometry = map.geometry();
    assert_eq!(index.sync(&geometry), 1);
    assert_eq!(index.sync(&geometry), 0);
    let target = CellRef {
        street: 0,
        lane: 0,
        index: 10,
    };
    assert_eq!(index.find_nearest(geometry[0].centers[0][10]), Some(target));
    assert_ne!(index.find_nearest([10.5, 0.5]), Some(target));
    let reloaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(reloaded.geometry(), geometry);
    index.sync_oriented(&geometry, &map.axes());
    // A 90-degree tangent at cell 10: the cell footprint is rotated with it.
    assert_eq!(index.hit_test(geometry[0].centers[0][10]), Some(target));
}

#[test]
fn background_zones_round_trip_and_new_map_has_none() {
    let map = MapDocument::parse(r##"{"calles":[],"backgroundAreas":[
        {"x":5,"y":10,"width":20,"height":15,"color":"#123456","label":"Rectangle"},
        {"vertices":[{"x":0,"y":0},{"x":5,"y":0},{"x":0,"y":5}],"color":"#ff0000","alpha":0.5,"label":"Triangle"}
    ]}"##).unwrap();
    assert_eq!(
        map.zones()[0].points,
        [[1.0, 2.0], [5.0, 2.0], [5.0, 5.0], [1.0, 5.0]]
    );
    assert_eq!(map.zones()[1].color, [255, 0, 0, 128]);
    assert_eq!(
        MapDocument::parse(&map.to_json()).unwrap().zones(),
        map.zones()
    );
    assert!(MapDocument::empty().zones().is_empty());
}

#[test]
fn curved_footprint_pick_uses_the_visible_topmost_cell() {
    use ca_core::cell_index::{CellIndex, CellRef};
    let map=MapDocument::parse(r#"{"calles":[{"nombre":"Curve","tipo":"conexion","tamano":21,"carriles":1,"esCurva":true,"vertices":[{"indiceCelda":0,"anguloOffset":0},{"indiceCelda":10,"anguloOffset":90},{"indiceCelda":20,"anguloOffset":0}]}]}"#).unwrap();
    let mut index = CellIndex::new(1.0);
    index.sync_oriented(&map.geometry(), &map.axes());
    assert_eq!(
        index.hit_test([0.95, -0.49]),
        Some(CellRef {
            street: 0,
            lane: 0,
            index: 1
        })
    );
}
