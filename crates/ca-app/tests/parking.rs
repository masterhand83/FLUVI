use ca_app::parking::ParkingOverlays;
use ca_core::{
    buildings::Building,
    cell_index::CellRef,
    map_json::MapDocument,
    parking::{ParkingConfig, ParkingPair},
};

#[test]
fn only_functional_parking_has_outline_links_and_counter() {
    let mut map = MapDocument::demo();
    let mut artwork = Building::rectangle([50., 100.], [20., 30.]);
    artwork.label = "Estacionamiento".into();
    let index = map.add_building(artwork).unwrap();
    assert!(
        ParkingOverlays::from_document(&map, [2., 3.])
            .items
            .is_empty()
    );
    map.configure_parking(
        index,
        Some(ParkingConfig::new(
            12,
            vec![ParkingPair {
                entrance: CellRef {
                    street: 0,
                    lane: 0,
                    index: 1,
                },
                exit: CellRef {
                    street: 0,
                    lane: 0,
                    index: 5,
                },
            }],
        )),
    )
    .unwrap();
    let mut overlays = ParkingOverlays::from_document(&map, [2., 3.]);
    overlays.set_occupancy(index, 3);
    assert_eq!(overlays.items.len(), 1);
    let item = &overlays.items[0];
    assert_eq!(item.center, [12., 23.]);
    assert_eq!(item.outline.len(), 4);
    assert_eq!(item.links.len(), 2);
    assert_eq!(item.counter(), "(3/12)");
    assert_eq!(item.links[0][1], item.center);
    assert_eq!(item.links[1][0], item.center);
    map.configure_parking(index, None).unwrap();
    assert!(
        ParkingOverlays::from_document(&map, [2., 3.])
            .items
            .is_empty()
    );
}

#[test]
fn vertex_edits_refresh_retained_parking_links() {
    use ca_app::{buildings::BuildingEditor, map_session::MapSession};
    let mut map = MapDocument::campus();
    let street = map
        .layout()
        .iter()
        .position(|s| s.curved && s.vertices.len() >= 3)
        .unwrap();
    let vertex = 1;
    let cell_index = map.layout()[street].vertices[vertex].index;
    let building = map
        .add_building(Building::rectangle([0.; 2], [10.; 2]))
        .unwrap();
    map.configure_parking(
        building,
        Some(ParkingConfig::new(
            10,
            vec![ParkingPair {
                entrance: CellRef {
                    street,
                    lane: 0,
                    index: cell_index,
                },
                exit: CellRef {
                    street,
                    lane: 0,
                    index: 0,
                },
            }],
        )),
    )
    .unwrap();
    let mut session = MapSession::<()>::new(map);
    let before = ParkingOverlays::from_document(session.document(), [0.; 2]).items[0].links[0][0];
    let mut editor = BuildingEditor::default();
    editor.sync_parking(session.document(), session.revision(), [0.; 2]);
    editor.set_parking_occupancy(building, 4);
    assert!(session.set_vertex_offset(street, vertex, 45.));
    editor.sync_parking(session.document(), session.revision(), [0.; 2]);
    let after = ParkingOverlays::from_document(session.document(), [0.; 2]).items[0].links[0][0];
    assert_ne!(before, after);
    // Inspect the public painted output, not the editor's private cache.
    let context = eframe::egui::Context::default();
    let mut expected = eframe::egui::Pos2::ZERO;
    let output = context.run(Default::default(), |ctx| {
        eframe::egui::CentralPanel::default().show(ctx, |ui| {
            let rect = ui.max_rect();
            expected = eframe::egui::pos2(
                rect.left() + after[0] / 500. * rect.width(),
                rect.top() + after[1] / 500. * rect.height(),
            );
            editor.paint_controls(
                ui.painter(),
                session.document(),
                ui.max_rect(),
                ca_core::camera::WorldView {
                    origin: [0.; 2],
                    span: [500.; 2],
                },
                [0.; 2],
            );
        });
    });
    assert!(output.shapes.iter().any(|shape| matches!(&shape.shape,
        eframe::egui::Shape::Text(text) if text.galley.job.text == "(4/10)")));
    assert!(output.shapes.iter().any(|shape| matches!(&shape.shape,
        eframe::egui::Shape::LineSegment { points, .. } if points[0].distance(expected) < 0.001)));
}

#[test]
fn deleting_an_earlier_building_keeps_the_surviving_live_count() {
    let mut map = MapDocument::demo();
    map.add_building(Building::rectangle([0.; 2], [10.; 2]))
        .unwrap();
    let building = map
        .add_building(Building::rectangle([50.; 2], [10.; 2]))
        .unwrap();
    map.configure_parking(
        building,
        Some(ParkingConfig::new(
            10,
            vec![ParkingPair {
                entrance: CellRef {
                    street: 0,
                    lane: 0,
                    index: 1,
                },
                exit: CellRef {
                    street: 0,
                    lane: 0,
                    index: 5,
                },
            }],
        )),
    )
    .unwrap();
    let mut overlays = ParkingOverlays::from_document(&map, [0.; 2]);
    overlays.set_occupancy(building, 4);
    map.delete_building(0);
    overlays.delete_building(0);
    overlays.refresh(&map, [0.; 2]);
    assert_eq!(overlays.items[0].building, 0);
    assert_eq!(overlays.items[0].counter(), "(4/10)");
    overlays.reset_occupancy();
    assert_eq!(overlays.items[0].counter(), "(0/10)");
    overlays.refresh(&MapDocument::empty(), [0.; 2]);
    assert!(overlays.items.is_empty());
}
