use ca_core::{
    cell_index::CellRef,
    map_json::MapDocument,
    streets::{StreetChange, StreetEdit},
};

#[test]
fn cancel_restores_original_geometry_and_keeps_physical_cells() {
    let mut map = MapDocument::parse(
        r#"{"calles":[{"nombre":"A","tipo":"conexion","tamano":5,"carriles":2,"x":25,"y":35,"angulo":30}]}"#,
    ).unwrap();
    map.model_mut().toggle_vehicle(CellRef {
        street: 0,
        lane: 1,
        index: 2,
    });
    let before = map.to_json();
    let centers = map.geometry()[0].centers.clone();
    let cells = map.model().streets()[0].cells().to_vec();
    map.edit_streets(StreetEdit::BeginSession(0)).unwrap();
    map.edit_streets(StreetEdit::Update(0, StreetChange::Origin([20.0, 10.0])))
        .unwrap();
    map.edit_streets(StreetEdit::Update(0, StreetChange::Angle(115.0)))
        .unwrap();
    assert_ne!(map.geometry()[0].centers, centers);
    map.edit_streets(StreetEdit::CancelSession).unwrap();
    assert_eq!(map.to_json(), before);
    assert_eq!(map.geometry()[0].centers, centers);
    assert_eq!(map.model().streets()[0].cells(), cells);
}

#[test]
fn save_keeps_the_session_edits_and_a_later_session_uses_that_state() {
    let mut map = MapDocument::empty();
    map.edit_streets(StreetEdit::Draw(ca_core::streets::StreetDraft {
        origin: [0.0; 2],
        angle_degrees: 0.0,
        cells: 5,
    }))
    .unwrap();
    map.edit_streets(StreetEdit::BeginSession(0)).unwrap();
    map.edit_streets(StreetEdit::Update(0, StreetChange::Origin([2.0, 3.0])))
        .unwrap();
    assert!(
        map.edit_streets(StreetEdit::Update(
            0,
            StreetChange::Dimensions {
                lanes: 2,
                length: 3
            }
        ))
        .is_err()
    );
    map.edit_streets(StreetEdit::SaveSession).unwrap();
    assert_eq!(map.editing_street(), None);
    assert_eq!(map.layout()[0].origin, [2.0, 3.0]);
    map.edit_streets(StreetEdit::BeginSession(0)).unwrap();
    map.edit_streets(StreetEdit::Update(0, StreetChange::Angle(80.0)))
        .unwrap();
    map.edit_streets(StreetEdit::CancelSession).unwrap();
    assert_eq!(map.layout()[0].origin, [2.0, 3.0]);
    assert_eq!(map.layout()[0].angle_degrees, 0.0);
}
