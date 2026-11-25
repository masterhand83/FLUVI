use ca_app::streets::sorted_streets;
use ca_core::map_json::MapDocument;

#[test]
fn spanish_numeric_selectors_keep_physical_indices_and_stable_ties() {
    let map = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"Street 10","tipo":"conexion","tamano":2},
        {"nombre":"Álamo","tipo":"conexion","tamano":2},
        {"nombre":"Street 2","tipo":"conexion","tamano":2},
        {"nombre":"alamo","tipo":"conexion","tamano":2},
        {"nombre":"ñandú","tipo":"conexion","tamano":2},
        {"nombre":"nube","tipo":"conexion","tamano":2},
        {"nombre":"oeste","tipo":"conexion","tamano":2},
        {"nombre":"Street 02","tipo":"conexion","tamano":2}
    ]}"#,
    )
    .unwrap();
    assert_eq!(sorted_streets(&map), [1, 3, 5, 4, 6, 2, 7, 0]);
    assert_eq!(map.layout()[0].name, "Street 10");
    assert_eq!(map.layout()[1].name, "Álamo");
}
