use ca_core::{
    cell_index::CellRef,
    map_json::MapDocument,
    streets::{StreetChange, StreetEdit},
};

#[test]
fn endpoint_edit_is_atomic_and_reconciles_connections() {
    let mut map = MapDocument::parse(r#"{
        "calles":[{"nombre":"A","tipo":"conexion","tamano":6},{"nombre":"B","tipo":"conexion","tamano":6}],
        "conexiones":[{"origenIdx":0,"destinoIdx":1,"tipo":"LINEAL","detalles":[
            {"carrilOrigen":0,"carrilDestino":0,"posOrigen":5,"posDestino":0}]}]
    }"#).unwrap();
    let before = map.to_json();
    let invalid = StreetEdit::Update(
        0,
        StreetChange::StraightGeometry {
            origin: [3.0, 4.0],
            angle: -90.0,
            length: 0,
        },
    );
    assert_eq!(
        map.edit_streets(invalid).unwrap_err().translation_key(),
        "streetInspector.errors.length"
    );
    assert_eq!(map.to_json(), before);
    map.edit_streets(StreetEdit::Update(
        0,
        StreetChange::StraightGeometry {
            origin: [3.0, 4.0],
            angle: -90.0,
            length: 4,
        },
    ))
    .unwrap();
    assert_eq!(map.layout()[0].origin, [3.0, 4.0]);
    assert_eq!(map.layout()[0].angle_degrees, -90.0);
    assert_eq!(map.model().streets()[0].config().tamano, 4);
    assert!(map.model().connections().is_empty());
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    let center = loaded.geometry()[0].centers[0][0];
    assert!((center[0] - 2.5).abs() < 0.001);
    assert!((center[1] - 4.5).abs() < 0.001);
}

#[test]
fn translating_a_curve_keeps_links_and_rejects_out_of_bounds_controls() {
    use ca_core::bezier::BezierChange;
    let mut map = MapDocument::parse(r#"{
        "calles":[{"nombre":"A","tipo":"conexion","tamano":6},{"nombre":"B","tipo":"conexion","tamano":6}],
        "conexiones":[{"origenIdx":0,"destinoIdx":1,"tipo":"LINEAL","detalles":[
            {"carrilOrigen":0,"carrilDestino":0,"posOrigen":5,"posDestino":0}]}]
    }"#).unwrap();
    map.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Bezier(BezierChange::Convert),
    ))
    .unwrap();
    let links = map.model().connections().to_vec();
    map.edit_streets(StreetEdit::Update(0, StreetChange::Origin([12.0, 8.0])))
        .unwrap();
    assert_eq!(
        map.layout()[0].bezier.as_ref().unwrap().start(),
        [12.0, 8.0]
    );
    assert_eq!(map.model().connections(), links);
    let before = map.to_json();
    let error = map
        .edit_streets(StreetEdit::Update(
            0,
            StreetChange::Origin([199_999.0, 0.0]),
        ))
        .unwrap_err();
    assert_eq!(error.translation_key(), "bezier.invalidControls");
    assert_eq!(map.to_json(), before);
}

#[test]
fn resize_keeps_new_endpoint_aliases_and_self_links_saveable() {
    let mut map = MapDocument::parse(r#"{
        "calles":[{"nombre":"A","tipo":"conexion","tamano":6},{"nombre":"B","tipo":"devorador","tamano":6}],
        "conexiones":[
            {"origenIdx":0,"destinoIdx":1,"tipo":"PROBABILISTICA","detalles":[{"carrilOrigen":0,"carrilDestino":0,"posOrigen":3,"probabilidad":0.2}]},
            {"origenIdx":0,"destinoIdx":1,"tipo":"PROBABILISTICA","detalles":[{"carrilOrigen":0,"carrilDestino":0,"posOrigen":-1,"probabilidad":0.8}]},
            {"origenIdx":0,"destinoIdx":0,"tipo":"LINEAL","detalles":[{"carrilOrigen":0,"carrilDestino":0,"posOrigen":-1,"posDestino":3}]}]
    }"#).unwrap();
    map.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Dimensions {
            lanes: 1,
            length: 4,
        },
    ))
    .unwrap();
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(loaded.model().connections(), map.model().connections());
    assert_eq!(loaded.model().connections().len(), 3);
    // The retained self-link is inert, not an artificial waiting condition.
    let mut self_only = MapDocument::parse(r#"{
        "calles":[{"nombre":"A","tipo":"conexion","tamano":4}],
        "conexiones":[{"origenIdx":0,"destinoIdx":0,"tipo":"LINEAL","detalles":[{"carrilOrigen":0,"carrilDestino":0,"posOrigen":-1,"posDestino":3}]}]
    }"#).unwrap();
    self_only.model_mut().toggle_vehicle(CellRef {
        street: 0,
        lane: 0,
        index: 3,
    });
    self_only.model_mut().tick();
    assert_eq!(self_only.model().streets()[0].cells(), [0, 0, 0, 0]);
}

#[test]
fn shrinking_lanes_keeps_disabled_surviving_merge_rows_saveable() {
    let mut map = MapDocument::parse(r#"{
        "calles":[{"nombre":"A","tipo":"conexion","tamano":4,"carriles":2},{"nombre":"B","tipo":"devorador","tamano":4}],
        "conexiones":[{"origenIdx":0,"destinoIdx":1,"tipo":"INCORPORACION","detalles":[
            {"carrilOrigen":0,"carrilDestino":0,"enabled":false},
            {"carrilOrigen":1,"carrilDestino":0,"enabled":true}]}]
    }"#).unwrap();
    map.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Dimensions {
            lanes: 1,
            length: 4,
        },
    ))
    .unwrap();
    assert_eq!(map.model().connections()[0].mappings().count(), 1);
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(loaded.model().connections()[0].mappings().count(), 1);
}

#[test]
fn direction_changes_keep_existing_links_saveable() {
    use ca_core::traffic::LaneDirection;
    let mut map = MapDocument::parse(r#"{
        "calles":[{"nombre":"A","tipo":"conexion","tamano":4},{"nombre":"B","tipo":"devorador","tamano":4}],
        "conexiones":[{"origenIdx":0,"destinoIdx":1,"tipo":"LINEAL","detalles":[{"carrilOrigen":0,"carrilDestino":0}]}]
    }"#).unwrap();
    map.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Direction {
            lane: 0,
            direction: LaneDirection::Reverse,
        },
    ))
    .unwrap();
    assert_eq!(map.model().connections().len(), 1);
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(loaded.model().connections().len(), 1);
    assert_eq!(
        loaded.model().streets()[0].lane_direction(0),
        LaneDirection::Reverse
    );
}

#[test]
fn exact_edits_round_trip_and_invalid_edits_keep_the_previous_value() {
    use ca_core::traffic::CalleType;
    let mut map = MapDocument::demo();
    for change in [
        StreetChange::Name("North".into()),
        StreetChange::Origin([12.5, -4.0]),
        StreetChange::Angle(45.0),
        StreetChange::Type(CalleType::Generador),
        StreetChange::Generation(0.4),
        StreetChange::LaneChange(0.15),
        StreetChange::LaneGeneration {
            lane: 0,
            enabled: false,
        },
    ] {
        map.edit_streets(StreetEdit::Update(0, change)).unwrap();
    }
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(loaded.layout()[0].name, "North");
    assert_eq!(loaded.layout()[0].origin, [12.5, -4.0]);
    assert_eq!(loaded.layout()[0].angle_degrees, 45.0);
    let c = loaded.model().streets()[0].config();
    assert_eq!(c.tipo, CalleType::Generador);
    assert_eq!(c.generation_probability, 0.4);
    assert_eq!(c.lane_change_probability, 0.15);
    assert_eq!(c.lane_generation_enabled[0], Some(false));
    let before = map.to_json();
    for (change, key) in [
        (
            StreetChange::Name("  ".into()),
            "streetInspector.errors.name",
        ),
        (
            StreetChange::Dimensions {
                lanes: 0,
                length: 4,
            },
            "streetInspector.errors.lanes",
        ),
        (
            StreetChange::Dimensions {
                lanes: 2,
                length: 2501,
            },
            "streetInspector.errors.length",
        ),
        (
            StreetChange::Generation(f64::NAN),
            "streetInspector.errors.probability",
        ),
        (
            StreetChange::LaneChange(1.1),
            "streetInspector.errors.probability",
        ),
        (
            StreetChange::Origin([f64::INFINITY, 0.0]),
            "streetInspector.errors.geometry",
        ),
        (
            StreetChange::Angle(1_000_001.0),
            "streetInspector.errors.geometry",
        ),
    ] {
        let error = map.edit_streets(StreetEdit::Update(0, change)).unwrap_err();
        assert_eq!(error.translation_key(), key);
        assert_eq!(map.to_json(), before);
    }
}

#[test]
fn lane_growth_keeps_switches_and_direction_edits_do_not_move_traffic() {
    use ca_core::{streets::StreetEvent, traffic::LaneDirection};
    let mut map = MapDocument::parse(
        r#"{"calles":[{
        "nombre":"A","tipo":"generador","tamano":3,"carriles":2,
        "laneDirections":[-1,1],"laneGenerationEnabled":[false,true]
    }]}"#,
    )
    .unwrap();
    map.model_mut().toggle_vehicle(CellRef {
        street: 0,
        lane: 0,
        index: 1,
    });
    map.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Dimensions {
            lanes: 3,
            length: 4,
        },
    ))
    .unwrap();
    let street = &map.model().streets()[0];
    assert_eq!(
        street.config().lane_generation_enabled,
        [Some(false), Some(true), Some(true)]
    );
    assert_eq!(
        (street.lane_direction(0), street.lane_direction(2)),
        (LaneDirection::Reverse, LaneDirection::Forward)
    );
    let before = street.cells().to_vec();
    let event = map
        .edit_streets(StreetEdit::Update(
            0,
            StreetChange::Direction {
                lane: 0,
                direction: LaneDirection::Forward,
            },
        ))
        .unwrap();
    assert_eq!(event, StreetEvent::LaneDirectionsChanged(0));
    assert_eq!(map.model().streets()[0].cells(), before);
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(
        loaded.model().streets()[0].lane_direction(0),
        LaneDirection::Forward
    );
    assert_eq!(
        loaded.model().streets()[0].config().lane_generation_enabled[0],
        Some(false)
    );
}

#[test]
fn shrinking_prunes_only_out_of_range_rows_and_preserves_physical_cells() {
    let mut map = MapDocument::parse(
        r#"{
        "calles":[
            {"nombre":"A","tipo":"conexion","tamano":6,"carriles":2},
            {"nombre":"B","tipo":"devorador","tamano":6}],
        "conexiones":[
            {"origenIdx":0,"destinoIdx":1,"tipo":"INCORPORACION","detalles":[
                {"carrilOrigen":0,"carrilDestino":0,"posOrigen":2,"posDestino":1},
                {"carrilOrigen":0,"carrilDestino":0,"posOrigen":5,"posDestino":2},
                {"carrilOrigen":1,"carrilDestino":0,"posOrigen":-1,"posDestino":3}]},
            {"origenIdx":1,"destinoIdx":0,"tipo":"LINEAL","detalles":[
                {"carrilOrigen":0,"carrilDestino":0,"posDestino":5}]}]
    }"#,
    )
    .unwrap();
    map.model_mut().toggle_vehicle(CellRef {
        street: 0,
        lane: 0,
        index: 2,
    });
    map.model_mut().toggle_vehicle(CellRef {
        street: 0,
        lane: 1,
        index: 1,
    });
    map.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Dimensions {
            lanes: 2,
            length: 4,
        },
    ))
    .unwrap();
    assert_eq!(map.model().streets()[0].cells(), &[0, 0, 1, 0, 0, 1, 0, 0]);
    let rows: Vec<_> = map
        .model()
        .connections()
        .iter()
        .flat_map(|c| c.mappings())
        .collect();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].source_cell, 2);
    assert_eq!(rows[1].source_cell, -1);
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(loaded.model().connections()[0].mappings().count(), 2);
    assert_eq!(loaded.model().connections().len(), 1);
}
