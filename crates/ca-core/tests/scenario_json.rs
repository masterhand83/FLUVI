use ca_core::{
    cell_index::CellRef, disruptions::Disruption, map_json::MapDocument, scenario_json::Scenario,
};

#[test]
fn v1_scenario_restores_marks_and_loads_rain_off() {
    let mut map = MapDocument::parse(include_str!("fixtures/map-v1.json")).unwrap();
    let scenario = Scenario::parse(r#"{
        "version":"1.0","id":"42","nombre":"Storm","descripcion":"",
        "callesConfig":[
            {"id":"Entrada","nombre":"Entrada","tamano":6,"carriles":2},
            {"id":"Salida","nombre":"Salida","tamano":6,"carriles":2}
        ],
        "lluviaAleatoria":{"activa":true,"probabilidad":37},
        "celdasBloqueadas":[
            {"calleNombre":"Entrada","calleId":"Entrada","carril":1,"indice":2,"tipo":"inundacion","texture":"inundacion"},
            {"calleNombre":"Salida","calleId":"Salida","carril":0,"indice":3,"tipo":"obstaculo","texture":"arbol"}
        ]
    }"#).unwrap();
    map.load_scenario(&scenario).unwrap();
    assert_eq!(
        map.model().disruption(CellRef {
            street: 0,
            lane: 1,
            index: 2
        }),
        Some(Disruption::Flood)
    );
    assert_eq!(
        map.model().disruption(CellRef {
            street: 1,
            lane: 0,
            index: 3
        }),
        Some(Disruption::Tree)
    );
    assert_eq!(map.model().rain(), (false, 0.37));
}

#[test]
fn capture_exports_all_v1_marks_and_rain_without_language() {
    let mut map = MapDocument::parse(include_str!("fixtures/map-v1.json")).unwrap();
    map.load_scenario(&Scenario::parse(include_str!("fixtures/scenario-v1.json")).unwrap())
        .unwrap();
    for (index, expected) in [
        Disruption::LaneBlock,
        Disruption::Pothole,
        Disruption::Worker,
        Disruption::Tree,
        Disruption::Cone,
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(
            map.model().disruption(CellRef {
                street: 1,
                lane: 0,
                index
            }),
            Some(expected)
        );
    }
    let saved = map.capture_scenario("Storm", "export-1").unwrap();
    let value: serde_json::Value = serde_json::from_str(&saved.to_json()).unwrap();
    assert_eq!(value["celdasBloqueadas"].as_array().unwrap().len(), 6);
    assert_eq!(
        value["lluviaAleatoria"],
        serde_json::json!({"probabilidad":37.0})
    );
    assert!(value.get("language").is_none());
}

#[test]
fn invalid_layout_and_addresses_leave_existing_marks_unchanged() {
    let mut map = MapDocument::parse(include_str!("fixtures/map-v1.json")).unwrap();
    let scenario = Scenario::parse(include_str!("fixtures/scenario-v1.json")).unwrap();
    map.load_scenario(&scenario).unwrap();
    for (field, value) in [("tamano", 7), ("carriles", 1)] {
        let mut bad = scenario.to_value();
        bad["callesConfig"][0][field] = value.into();
        let error = map
            .load_scenario(&Scenario::from_value(bad).unwrap())
            .unwrap_err();
        assert_eq!(error.translation_key(), "scenarios.layoutMismatch");
        assert_eq!(
            map.model().disruption(CellRef {
                street: 0,
                lane: 1,
                index: 2
            }),
            Some(Disruption::Flood)
        );
    }
    let mut bad = scenario.to_value();
    bad["celdasBloqueadas"][0]["indice"] = 6.into();
    assert!(
        map.load_scenario(&Scenario::from_value(bad).unwrap())
            .is_err()
    );
    assert_eq!(map.model().rain(), (false, 0.37));
}

#[test]
fn map_and_rain_only_scenario_save_probability_and_load_rain_off() {
    let mut map = MapDocument::parse(include_str!("fixtures/map-v1.json")).unwrap();
    map.model_mut().set_rain(true, 0.63).unwrap();
    let scenario = map.capture_scenario("Rain only", "rain-1").unwrap();
    assert!(
        scenario.to_value()["celdasBloqueadas"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let saved: serde_json::Value = serde_json::from_str(&map.to_json()).unwrap();
    assert_eq!(
        saved["lluviaAleatoria"],
        serde_json::json!({"probabilidad":63.0})
    );
    assert_eq!(
        MapDocument::parse(&saved.to_string())
            .unwrap()
            .model()
            .rain(),
        (false, 0.63)
    );
    map.load_scenario(&scenario).unwrap();
    assert_eq!(map.model().rain(), (false, 0.63));
    let mut old = scenario.to_value();
    old.as_object_mut().unwrap().remove("lluviaAleatoria");
    map.load_scenario(&Scenario::from_value(old).unwrap())
        .unwrap();
    assert_eq!(map.model().rain(), (false, 0.1));
}
