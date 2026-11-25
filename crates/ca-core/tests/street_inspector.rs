use ca_core::{
    cell_index::CellRef,
    map_json::MapDocument,
    streets::{StreetChange, StreetEdit},
};

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
