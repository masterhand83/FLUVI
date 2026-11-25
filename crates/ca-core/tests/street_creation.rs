use ca_core::{
    map_json::MapDocument,
    streets::{StreetDefinition, StreetDraft, StreetEdit},
    traffic::CalleType,
};

#[test]
fn form_and_drawing_share_the_same_street_factory() {
    let draft = StreetDraft {
        origin: [5.0, 7.0],
        angle_degrees: 30.0,
        cells: 8,
    };
    let mut drawing = MapDocument::empty();
    drawing.edit_streets(StreetEdit::Draw(draft)).unwrap();
    let mut form = MapDocument::empty();
    form.edit_streets(StreetEdit::Create(StreetDefinition {
        name: "Street 1".into(),
        draft,
        lanes: 1,
        tipo: CalleType::Conexion,
        generation: 0.0,
        lane_change: 0.02,
    }))
    .unwrap();
    assert_eq!(form.to_json(), drawing.to_json());
    assert_eq!(form.geometry()[0].centers, drawing.geometry()[0].centers);
    let placement = &form.layout()[0];
    assert_eq!(placement.name, "Street 1");
    assert_eq!(placement.origin, [5.0, 7.0]);
    assert_eq!(placement.angle_degrees, 30.0);
    let street = &form.model().streets()[0];
    assert_eq!(street.config().tipo, CalleType::Conexion);
    assert_eq!(street.config().carriles, 1);
    assert_eq!(street.config().tamano, 8);
    assert_eq!(street.config().generation_probability, 0.0);
    assert_eq!(street.config().lane_change_probability, 0.02);
    assert_eq!(street.cells(), [0; 8]);
    // Worked 30-degree placement of the first and last cell centers about (5, 7).
    let geometry = form.geometry();
    let centers = &geometry[0].centers[0];
    for (actual, expected) in [
        (centers[0], [5.683013, 7.183013]),
        (centers[7], [11.745191, 3.683013]),
    ] {
        assert!((actual[0] - expected[0]).abs() < 0.00001);
        assert!((actual[1] - expected[1]).abs() < 0.00001);
    }
}
