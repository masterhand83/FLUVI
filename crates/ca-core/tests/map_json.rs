use ca_core::{map_json::MapDocument, traffic::LaneDirection};
use serde_json::json;

#[test]
fn real_v1_fixture_preserves_streets_lanes_and_links() {
    let map = MapDocument::parse(include_str!("fixtures/map-v1.json")).unwrap();
    assert_eq!(map.model().streets().len(), 2);
    assert_eq!(map.model().streets()[0].config().tamano, 6);
    assert_eq!(map.model().streets()[0].config().carriles, 2);
    assert_eq!(
        map.model().streets()[0].config().generation_probability,
        0.35
    );
    assert_eq!(
        map.model().streets()[1].lane_direction(1),
        LaneDirection::Reverse
    );
    assert_eq!(map.model().connections().len(), 4);
    let saved = map.to_json();
    let reloaded = MapDocument::parse(&saved).unwrap();
    assert_eq!(reloaded.to_json(), saved);
    assert_eq!(reloaded.model().connections(), map.model().connections());
    for (before, after) in map.model().streets().iter().zip(reloaded.model().streets()) {
        assert_eq!(before.config(), after.config());
        assert_eq!(before.cells(), after.cells());
    }
}

#[test]
fn v1_probability_trials_keep_their_individual_weights_and_registration_order() {
    let mut input: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/map-v1.json")).unwrap();
    input["conexiones"] = json!([
        {"origenIdx": 0, "destinoIdx": 1, "tipo": "PROBABILISTICA", "detalles": [
            {"carrilOrigen": 0, "carrilDestino": 0, "posOrigen": -1, "posDestino": 0, "probabilidad": 0}
        ]},
        {"origenIdx": 0, "destinoIdx": 1, "tipo": "LINEAL", "detalles": [
            {"carrilOrigen": 0, "carrilDestino": 0, "posOrigen": -1, "posDestino": 1}
        ]},
        {"origenIdx": 0, "destinoIdx": 1, "tipo": "PROBABILISTICA", "detalles": [
            {"carrilOrigen": 0, "carrilDestino": 0, "posOrigen": 5, "posDestino": 2, "probabilidad": 1}
        ]}
    ]);
    let map = MapDocument::parse(&input.to_string()).unwrap();
    assert_eq!(map.model().connections().len(), 3);
    let mut model = map.model().clone();
    assert!(model.toggle_vehicle(ca_core::cell_index::CellRef {
        street: 0,
        lane: 0,
        index: 5
    }));
    model.transfer_connections();
    // V1: the first trial (0) declines, the middle link transfers, and the
    // last trial (1) sees no vehicle. Grouping trials changes this outcome.
    assert_eq!(model.streets()[1].cells()[..3], [0, 1, 0]);
    assert_eq!(
        MapDocument::parse(&map.to_json())
            .unwrap()
            .model()
            .connections(),
        map.model().connections()
    );
}

#[test]
fn a_single_v1_probability_trial_does_not_need_split_weights() {
    let mut input: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/map-v1.json")).unwrap();
    input["conexiones"] = json!([{
        "origenIdx": 0, "destinoIdx": 1, "tipo": "PROBABILISTICA",
        "detalles": [{"carrilOrigen": 0, "carrilDestino": 0, "probabilidad": 0.5}]
    }]);
    let map = MapDocument::parse(&input.to_string()).unwrap();
    assert_eq!(map.model().connections().len(), 1);
}

#[test]
fn older_v1_maps_get_defaults_and_keep_unowned_fields() {
    let input = json!({
        "nombre": "Campus", "language": "es", "future": {"keep": 42},
        "calles": [
            {"nombre": "Entrada", "tamano": 6, "tipo": "generador",
             "x": 10, "y": 20, "angulo": 0, "carriles": 2,
             "probabilidadGeneracion": 0.35, "customRoad": "keep"},
            {"nombre": "Salida", "tamano": 6, "tipo": "devorador",
             "x": 50, "y": 20, "angulo": 0, "carriles": 2,
             "laneDirections": [1, -1], "laneGenerationEnabled": [true, false]}
        ],
        "conexiones": [{"origenIdx": 0, "destinoIdx": 1, "tipo": "LINEAL",
            "detalles": [{"carrilOrigen": 0, "carrilDestino": 0}]}]
    });
    let map = MapDocument::parse(&input.to_string()).unwrap();
    assert_eq!(map.model().streets().len(), 2);
    assert_eq!(
        map.model().streets()[0].config().lane_change_probability,
        0.05
    );
    assert_eq!(
        map.model().streets()[0].lane_direction(1),
        LaneDirection::Forward
    );
    assert_eq!(
        map.model().streets()[1].lane_direction(1),
        LaneDirection::Reverse
    );
    let row = map.model().connections()[0].mappings().next().unwrap();
    assert_eq!(row.source_cell, -1);
    assert_eq!(row.destination_cell, 0);
    let output: serde_json::Value = serde_json::from_str(&map.to_json()).unwrap();
    assert_eq!(output["future"]["keep"], 42);
    assert_eq!(output["calles"][0]["customRoad"], "keep");
    assert!(output.get("language").is_none());
    assert_eq!(
        MapDocument::parse(&map.to_json()).unwrap().to_json(),
        map.to_json()
    );
}
