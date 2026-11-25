use ca_core::bezier::{BezierCurve, Section};
use ca_core::map_json::MapDocument;
use ca_core::{
    bezier::{BezierChange, CurvePoint},
    streets::{StreetChange, StreetEdit},
};
use serde_json::{Value, json};

#[test]
fn importing_curves_checks_overlap_size_and_conflicting_geometry() {
    let fixtures: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/bezier-v1.json")).unwrap();
    assert!(MapDocument::parse(&json!({"calles":[fixtures[3]["street"]]}).to_string()).is_err());
    let mut street = fixtures[0]["street"].clone();
    street["tamano"] = json!(1);
    assert!(MapDocument::parse(&json!({"calles":[street]}).to_string()).is_err());
    let mut street = fixtures[0]["street"].clone();
    street["geometryType"] = json!("roundabout");
    street["innerRadius"] = json!(5);
    street["startAngle"] = json!(0);
    street["tamano"] = json!(9);
    assert!(MapDocument::parse(&json!({"calles":[street]}).to_string()).is_err());
}

#[test]
fn excessive_sampling_work_is_rejected_before_building_a_cache() {
    let controls = (0..32)
        .map(|i| [if i % 2 == 0 { 200_000.0 } else { -200_000.0 }, 0.0])
        .collect();
    assert!(
        BezierCurve::new(
            [0.0; 2],
            vec![Section {
                controls,
                end: [10.0, 0.0]
            }]
        )
        .is_err()
    );
}

#[test]
fn arc_length_not_parameter_time_places_cells_and_lanes() {
    // B(t) = 20t² along a straight line. Uniform t would not give unit spacing.
    let curve = BezierCurve::new(
        [2.0, 3.0],
        vec![Section {
            controls: vec![[2.0, 3.0]],
            end: [22.0, 3.0],
        }],
    )
    .unwrap();
    assert_eq!(curve.validate(2).unwrap(), 20);
    for index in 0..20 {
        for (lane, y) in [(0, 2.5), (1, 3.5)] {
            let (center, axis) = curve.cell(lane, 2, index);
            assert!((center[0] - (index as f32 + 2.5)).abs() < 0.00001);
            assert_eq!(center[1], y);
            assert_eq!(axis, [1.0, 0.0]);
        }
    }
    // Independent analytic arc integral for x=20t, y=20t(1-t).
    let parabola = BezierCurve::new(
        [0.0; 2],
        vec![Section {
            controls: vec![[10.0, 10.0]],
            end: [20.0, 0.0],
        }],
    )
    .unwrap();
    let integral = |u: f64| u * (1.0 + u * u).sqrt() + u.asinh();
    for index in 0..parabola.cell_count() {
        let center = parabola.cell(0, 1, index).0;
        let t = center[0] as f64 / 20.0;
        let arc = 5.0 * (integral(1.0) - integral(1.0 - 2.0 * t));
        assert!((arc - (index as f64 + 0.5)).abs() < 0.0002);
    }
}

#[test]
fn curved_cells_are_interactive_but_the_old_straight_footprint_is_not() {
    use ca_core::cell_index::{CellIndex, CellRef};
    let fixtures: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/bezier-v1.json")).unwrap();
    let map = MapDocument::parse(&json!({"calles":[fixtures[0]["street"]]}).to_string()).unwrap();
    let geometry = map.geometry_snapshot();
    let mut index = CellIndex::new(1.0);
    index.sync_oriented(&geometry.streets, &geometry.axes);
    let p = &fixtures[0]["centers"][0][11];
    assert_eq!(
        index.hit_test([p[0].as_f64().unwrap() as f32, p[1].as_f64().unwrap() as f32]),
        Some(CellRef {
            street: 0,
            lane: 0,
            index: 11
        })
    );
    assert!(index.hit_test([12.0, 4.0]).is_none());
}

#[test]
fn removing_an_anchor_joins_sections_without_retaining_the_corner_as_a_control() {
    let mut map = MapDocument::parse(
        r#"{"calles":[{
        "nombre":"Corner","tipo":"conexion","tamano":39,"bezierGeometry":true,
        "bezierControls":[],"endX":100,"endY":100,"bezierSegments":[
            {"controls":[],"end":{"x":100,"y":0}},
            {"controls":[],"end":{"x":100,"y":100}}
        ]
    }]}"#,
    )
    .unwrap();
    map.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Bezier(BezierChange::Remove(CurvePoint::Anchor(0))),
    ))
    .unwrap();
    let curve = map.layout()[0].bezier.as_ref().unwrap();
    assert_eq!(
        curve.sections(),
        [Section {
            controls: vec![],
            end: [20.0, 20.0]
        }]
    );
    assert_eq!(curve.point(0.5), [10.0, 10.0]);
    let saved: Value = serde_json::from_str(&map.to_json()).unwrap();
    assert!(saved["calles"][0].get("bezierSegments").is_none());
    assert_eq!(saved["calles"][0]["vertices"], json!([]));
}

#[test]
fn curve_edits_are_atomic_and_keep_the_v1_storage_contract() {
    let mut map = MapDocument::parse(
        r#"{"calles":[{
        "nombre":"A","tipo":"conexion","tamano":10,"carriles":2
    }]}"#,
    )
    .unwrap();
    let edit = |change| StreetEdit::Update(0, StreetChange::Bezier(change));
    map.edit_streets(edit(BezierChange::Convert)).unwrap();
    map.edit_streets(edit(BezierChange::Move(
        CurvePoint::Control(0, 0),
        [5.0, 1.0],
    )))
    .unwrap();
    let before = map.to_json();
    let geometry = map.geometry_snapshot().streets[0].centers.clone();
    // v1 rejects this two-lane quadratic (control 25,200 in saved map units).
    let error = map
        .edit_streets(edit(BezierChange::Strength(4.0)))
        .unwrap_err();
    assert_eq!(error.translation_key(), "bezier.overlap");
    assert_eq!(map.to_json(), before);
    assert_eq!(map.geometry_snapshot().streets[0].centers, geometry);
    map.edit_streets(edit(BezierChange::Strength(0.4))).unwrap();
    let curve = map.layout()[0].bezier.as_ref().unwrap();
    assert_eq!(curve.sections()[0].controls, [[5.0, 4.0]]);
    let saved: Value = serde_json::from_str(&map.to_json()).unwrap();
    assert_eq!(saved["calles"][0]["bezierGeometry"], true);
    assert_eq!(saved["calles"][0]["vertices"], json!([]));
    assert_eq!(
        saved["calles"][0]["bezierControls"],
        json!([{"x":25.0,"y":20.0}])
    );
    assert_eq!(saved["calles"][0]["endX"].as_f64(), Some(50.0));
    assert_eq!(map.model().streets()[0].config().tamano, 11);
    let reloaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(
        reloaded.geometry_snapshot().streets[0].centers,
        map.geometry_snapshot().streets[0].centers
    );
}

#[test]
fn folded_lanes_are_rejected_without_rejecting_rounded_corners() {
    let curve = BezierCurve::new(
        [0.0, 0.0],
        vec![Section {
            controls: vec![[40.0, 20.0], [-20.0, 20.0]],
            end: [20.0, 0.0],
        }],
    )
    .unwrap();
    assert_eq!(
        curve.validate(2).unwrap_err().translation_key(),
        "bezier.overlap"
    );
    let corner = BezierCurve::new(
        [0.0, 0.0],
        vec![
            Section {
                controls: vec![],
                end: [20.0, 0.0],
            },
            Section {
                controls: vec![],
                end: [20.0, 20.0],
            },
        ],
    )
    .unwrap();
    assert!(corner.validate(2).is_ok());
    assert_eq!(corner.sections()[0].end, [20.0, 0.0]);
    assert_ne!(corner.point(0.5), [20.0, 0.0]);
}

#[test]
fn exact_section_split_keeps_the_quadratic_path() {
    let curve = BezierCurve::new(
        [0.0, 0.0],
        vec![Section {
            controls: vec![[4.0, 8.0]],
            end: [8.0, 0.0],
        }],
    )
    .unwrap();
    let split = curve.split(0, 0.5).unwrap();
    assert_eq!(
        split.sections()[0],
        Section {
            controls: vec![[2.0, 4.0]],
            end: [4.0, 4.0]
        }
    );
    assert_eq!(
        split.sections()[1],
        Section {
            controls: vec![[6.0, 4.0]],
            end: [8.0, 0.0]
        }
    );
    for (t, expected) in [
        (0.0, [0.0, 0.0]),
        (0.25, [2.0, 3.0]),
        (0.5, [4.0, 4.0]),
        (0.75, [6.0, 3.0]),
        (1.0, [8.0, 0.0]),
    ] {
        let section = usize::from(t > 0.5);
        assert_eq!(
            split.point(t),
            expected,
            "a smooth split must not add display rounding"
        );
        assert_eq!(
            split.section_point(section, t * 2.0 - section as f64),
            Some(expected)
        );
    }
    for index in 0..curve.cell_count() {
        let before = curve.cell(0, 1, index).0;
        let after = split.cell(0, 1, index).0;
        assert!((before[0] - after[0]).hypot(before[1] - after[1]) < 0.0002);
    }
    assert!(curve.split(0, 0.0).is_err());
}

#[test]
fn loaded_curve_cells_match_the_v1_reference() {
    let fixtures: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/bezier-v1.json")).unwrap();
    for fixture in fixtures.iter().filter(|f| f["valid"] == true) {
        let map = MapDocument::parse(&json!({"calles":[fixture["street"]]}).to_string()).unwrap();
        let geometry = map.geometry_snapshot();
        for (lane, centers) in geometry.streets[0].centers.iter().enumerate() {
            for (index, center) in centers.iter().enumerate() {
                for axis in 0..2 {
                    let expected = fixture["centers"][lane][index][axis].as_f64().unwrap();
                    assert!(
                        (center[axis] as f64 - expected).abs() < 0.0001,
                        "{} lane {lane} cell {index}: {center:?}",
                        fixture["street"]["nombre"]
                    );
                }
            }
        }
        let loaded = MapDocument::parse(&map.to_json()).unwrap();
        assert_eq!(
            loaded.geometry_snapshot().streets[0].centers,
            geometry.streets[0].centers
        );
    }
}
