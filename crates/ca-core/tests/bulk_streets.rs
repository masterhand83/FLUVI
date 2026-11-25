use ca_core::{map_json::MapDocument, streets::StreetEdit, traffic::LaneDirection};

#[test]
fn a_bad_bulk_candidate_leaves_every_street_unchanged() {
    let mut map = MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":5},{"nombre":"B","tipo":"conexion","tamano":6}]}"#,
    ).unwrap();
    let before = map.to_json();
    assert!(
        map.edit_streets(StreetEdit::Bulk {
            streets: vec![0, 99],
            lanes: 2,
            directions: vec![LaneDirection::Forward, LaneDirection::Reverse],
        })
        .is_err()
    );
    assert_eq!(map.to_json(), before);
}

#[test]
fn the_combined_cell_budget_is_checked_before_any_street_changes() {
    let roads: Vec<_> = (0..41)
        .map(|i| {
            serde_json::json!({
                "nombre": format!("Road {i}"), "tipo": "conexion", "tamano": 2500,
            })
        })
        .collect();
    let mut map = MapDocument::parse(&serde_json::json!({"calles": roads}).to_string()).unwrap();
    let before = map.to_json();
    assert_eq!(
        map.edit_streets(StreetEdit::Bulk {
            streets: (0..41).collect(),
            lanes: 10,
            directions: vec![LaneDirection::Forward; 10],
        })
        .unwrap_err()
        .translation_key(),
        "streetInspector.errors.capacity"
    );
    assert_eq!(map.to_json(), before);
}

#[test]
fn bulk_lane_resize_keeps_surviving_cells_and_removes_only_out_of_range_links() {
    use ca_core::cell_index::CellRef;
    let mut map = MapDocument::parse(r#"{
        "calles":[
            {"nombre":"A","tipo":"conexion","tamano":4,"carriles":2,"laneGenerationEnabled":[false,true]},
            {"nombre":"B","tipo":"devorador","tamano":4,"carriles":2}],
        "conexiones":[{"origenIdx":0,"destinoIdx":1,"tipo":"LINEAL","detalles":[
            {"carrilOrigen":0,"carrilDestino":0,"posOrigen":3,"posDestino":0},
            {"carrilOrigen":1,"carrilDestino":1,"posOrigen":3,"posDestino":0}]}]
    }"#).unwrap();
    map.model_mut().toggle_vehicle(CellRef {
        street: 0,
        lane: 0,
        index: 2,
    });
    map.edit_streets(StreetEdit::Bulk {
        streets: vec![0, 1],
        lanes: 1,
        directions: vec![LaneDirection::Reverse],
    })
    .unwrap();
    assert_eq!(map.model().streets()[0].cells(), [0, 0, 1, 0]);
    assert_eq!(
        map.model().streets()[0].config().lane_generation_enabled,
        [Some(false)]
    );
    for street in map.model().streets() {
        assert_eq!(street.config().carriles, 1);
        assert_eq!(street.lane_direction(0), LaneDirection::Reverse);
    }
    let links: Vec<_> = map
        .model()
        .connections()
        .iter()
        .flat_map(|c| c.mappings())
        .collect();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].source_lane, 0);
    assert_eq!(links[0].destination_lane, 0);
}
