use ca_core::{map_json::MapDocument, streets::StreetDraft};

#[test]
fn diagonal_draft_round_trips_with_the_previewed_length() {
    let draft = StreetDraft::between([10.0, 20.0], [13.0, 24.0]).unwrap();
    assert_eq!(draft.cells, 5);
    let mut map = MapDocument::empty();
    let id = map.draw_street(draft).unwrap();
    assert_eq!(id, 0);
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(loaded.model().streets()[0].config().tamano, 5);
    assert_eq!(loaded.layout()[0].name, "Street 1");
    assert_eq!(loaded.layout()[0].origin, [10.0, 20.0]);
    let end = loaded.geometry()[0].centers[0][4];
    assert!((end[0] - 12.3).abs() < 0.001);
    assert!((end[1] - 23.9).abs() < 0.001);
}

#[test]
fn deletion_removes_owned_links_remaps_survivors_and_keeps_traffic() {
    use ca_core::cell_index::CellRef;
    let mut map = MapDocument::parse(r#"{
        "calles":[
            {"nombre":"Removed","tipo":"conexion","tamano":4},
            {"nombre":"Source","tipo":"conexion","tamano":4},
            {"nombre":"Destination","tipo":"devorador","tamano":4}],
        "conexiones":[
            {"origenIdx":0,"destinoIdx":1,"tipo":"LINEAL","detalles":[{"carrilOrigen":0,"carrilDestino":0}]},
            {"origenIdx":1,"destinoIdx":2,"tipo":"LINEAL","detalles":[{"carrilOrigen":0,"carrilDestino":0}]}]
    }"#).unwrap();
    assert!(map.delete_street(0));
    assert!(!map.delete_street(8));
    assert_eq!(
        map.layout()
            .iter()
            .map(|p| p.name.as_str())
            .collect::<Vec<_>>(),
        ["Source", "Destination"]
    );
    let mut model = map.model().clone();
    assert_eq!(model.connections().len(), 1);
    let row = model.connections()[0].mappings().next().unwrap();
    assert_eq!((row.source_street, row.destination_street), (0, 1));
    model.toggle_vehicle(CellRef {
        street: 0,
        lane: 0,
        index: 3,
    });
    model.tick();
    assert_eq!(model.streets()[1].cells(), &[0, 1, 0, 0]);
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(loaded.model().connections().len(), 1);
}
