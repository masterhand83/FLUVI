use ca_core::{cell_index::CellRef, map_json::MapDocument};

fn ring() -> MapDocument {
    // Captured through the real v1 guardarSimulacion path; only volatile
    // timestamps and unrelated session fields were omitted.
    MapDocument::parse(include_str!("fixtures/roundabout-v1.json")).unwrap()
}

#[test]
fn both_lane_directions_wrap_without_losing_vehicles() {
    let mut map = ring();
    for (lane, index) in [(0, 8), (1, 0)] {
        assert!(map.model_mut().toggle_vehicle(CellRef {
            street: 0,
            lane,
            index
        }));
    }
    map.model_mut().tick();
    assert_eq!(
        map.model().streets()[0].cells(),
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,]
    );
    map.model_mut().tick();
    assert_eq!(
        map.model().streets()[0].cells(),
        [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,]
    );
}

#[test]
fn sector_counts_match_v1_samples_and_invalid_radii_are_rejected() {
    use ca_core::streets::RoundaboutDraft;
    // v1 roundaboutStreet.sectorCount, with its five-unit cell size.
    for (radius, cells) in [(1.0, 4), (5.0, 9), (10.0, 16), (25.0, 35), (50.0, 66)] {
        let draft = RoundaboutDraft::between([0.0, 0.0], [radius / 5.0, 0.0]).unwrap();
        assert_eq!(draft.cells(), cells);
    }
    for radius in [0.0, -1.0, f64::NAN, f64::INFINITY, 1000.0] {
        assert!(RoundaboutDraft::new([0.0; 2], radius, 0.0).is_err());
    }
}

#[test]
fn v1_fields_round_trip_and_geometry_uses_clockwise_sector_centers() {
    let map = ring();
    let saved: serde_json::Value = serde_json::from_str(&map.to_json()).unwrap();
    let original: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/roundabout-v1.json")).unwrap();
    assert_eq!(saved["calles"], original["calles"]);
    for (key, expected) in [
        ("geometryType", serde_json::json!("roundabout")),
        ("x", serde_json::json!(100)),
        ("y", serde_json::json!(200)),
        ("innerRadius", serde_json::json!(5)),
        ("startAngle", serde_json::json!(30)),
        ("tamano", serde_json::json!(9)),
        ("laneDirections", serde_json::json!([1, -1])),
    ] {
        assert_eq!(saved["calles"][0][key], expected);
    }
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    let geometry = loaded.geometry_snapshot();
    // Sector zero center is at 50 degrees; lane radii are 7.5 and 12.5 v1 units.
    for (actual, expected) in [
        (geometry.streets[0].centers[0][0], [20.964182, 41.149067]),
        (geometry.streets[0].centers[1][0], [21.60697, 41.91511]),
        (geometry.axes[0][0][0], [-0.76604444, 0.64278764]),
    ] {
        for i in 0..2 {
            assert!((actual[i] - expected[i]).abs() < 0.00001);
        }
    }
    for (key, value) in [
        ("innerRadius", serde_json::json!(0)),
        ("startAngle", serde_json::json!("bad")),
        ("tamano", serde_json::json!(10)),
        ("tipo", serde_json::json!("generador")),
    ] {
        let mut invalid = saved.clone();
        invalid["calles"][0][key] = value;
        assert!(MapDocument::parse(&invalid.to_string()).is_err(), "{key}");
    }
}

#[test]
fn resizing_remaps_vehicles_and_links_to_nearest_angle() {
    use ca_core::streets::{StreetChange, StreetEdit};
    let mut saved: serde_json::Value = serde_json::from_str(&ring().to_json()).unwrap();
    saved["conexiones"] = serde_json::json!([{
        "origenIdx":0,"destinoIdx":0,"tipo":"LINEAL",
        "detalles":[{"carrilOrigen":1,"carrilDestino":1,"posOrigen":8,"posDestino":0}]
    }]);
    let mut map = MapDocument::parse(&saved.to_string()).unwrap();
    for index in [2, 6] {
        map.model_mut().toggle_vehicle(CellRef {
            street: 0,
            lane: 0,
            index,
        });
    }
    map.edit_streets(StreetEdit::Update(0, StreetChange::Radius(2.0)))
        .unwrap();
    assert_eq!(map.model().streets()[0].config().tamano, 16);
    let occupied: Vec<_> = map.model().streets()[0]
        .cells()
        .iter()
        .enumerate()
        .filter(|(_, v)| **v != 0)
        .map(|(i, _)| i)
        .collect();
    assert_eq!(occupied, [4, 11]);
    let link = map.model().connections()[0].mappings().next().unwrap();
    assert_eq!((link.source_cell, link.destination_cell), (15, 0));
    let reloaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(reloaded.model().connections(), map.model().connections());
    assert!(
        map.edit_streets(StreetEdit::Update(0, StreetChange::Radius(0.0)))
            .is_err()
    );
    assert!(
        map.edit_streets(StreetEdit::Update(
            0,
            StreetChange::Dimensions {
                lanes: 2,
                length: 20
            }
        ))
        .is_err()
    );
}

#[test]
fn waiting_state_keeps_its_angle_after_resize_and_link_removal() {
    use ca_core::streets::{StreetChange, StreetEdit};
    let mut saved: serde_json::Value = serde_json::from_str(&ring().to_json()).unwrap();
    saved["conexiones"] = serde_json::json!([{
        "origenIdx":0,"destinoIdx":0,"tipo":"LINEAL",
        "detalles":[{"carrilOrigen":0,"carrilDestino":1,"posOrigen":6,"posDestino":8}]
    }]);
    let mut map = MapDocument::parse(&saved.to_string()).unwrap();
    for (lane, index) in [(0, 6), (1, 8)] {
        map.model_mut().toggle_vehicle(CellRef {
            street: 0,
            lane,
            index,
        });
    }
    map.model_mut().transfer_connections();
    map.edit_streets(StreetEdit::Update(0, StreetChange::Radius(2.0)))
        .unwrap();
    map.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Dimensions {
            lanes: 1,
            length: 16,
        },
    ))
    .unwrap();
    assert!(map.model().connections().is_empty());
    map.model_mut().tick();
    assert_eq!(
        map.model().streets()[0].cells(),
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]
    );
    map.model_mut().tick();
    assert_eq!(
        map.model().streets()[0].cells(),
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
    );
}

#[test]
fn periodic_snapshot_respects_waiting_destinations_and_vehicle_types() {
    use ca_core::traffic::{Calle, CalleConfig, CalleType};
    let mut config = CalleConfig::new(1, 9, CalleType::Conexion);
    config.periodic = true;
    let mut street = Calle::new(config, vec![6, 0, 2, 3, 0, 7, 0, 0, 0]).unwrap();
    street.set_waiting(0, 1, true);
    street.update();
    assert_eq!(street.cells(), [6, 0, 2, 0, 3, 7, 0, 0, 0]);
    street.update();
    assert_eq!(street.cells(), [0, 6, 0, 2, 3, 7, 0, 0, 0]);
}

#[test]
fn drawing_a_ring_uses_the_shared_document_edit_boundary() {
    use ca_core::streets::{RoundaboutDraft, StreetEdit, StreetEvent};
    let mut map = MapDocument::empty();
    let draft = RoundaboutDraft::between([4.0, 6.0], [6.0, 6.0]).unwrap();
    assert_eq!(
        map.edit_streets(StreetEdit::DrawRoundabout(draft)).unwrap(),
        StreetEvent::Drawn(0)
    );
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(loaded.layout()[0].roundabout, Some(draft));
    assert_eq!(loaded.model().streets()[0].config().tamano, 16);
    assert!(loaded.model().streets()[0].config().periodic);
}

#[test]
fn lane_changes_cross_the_seam_in_both_directions() {
    use ca_core::traffic::{Calle, CalleConfig, CalleType, LaneDirection, TrafficModel};
    for (direction, source, destination) in [
        (LaneDirection::Forward, 8, 9),
        (LaneDirection::Reverse, 0, 17),
    ] {
        let mut config = CalleConfig::new(2, 9, CalleType::Conexion);
        config.periodic = true;
        config.lane_directions = vec![Some(direction); 2];
        config.lane_change_probability = 1.0;
        let mut cells = vec![0; 18];
        cells[source] = 6;
        let mut model = TrafficModel::new(vec![Calle::new(config, cells).unwrap()], 42);
        model.tick();
        let mut expected = [0; 18];
        expected[destination] = 6;
        assert_eq!(model.streets()[0].cells(), expected);
    }
}

#[test]
fn a_declined_exit_trial_keeps_circulating_as_in_v1() {
    use ca_core::connections::{Connection, Mapping, WeightedRow};
    let mut map = ring();
    map.model_mut()
        .add_connection(Connection::ProbabilityTrial(WeightedRow {
            mapping: Mapping {
                source_street: 0,
                source_lane: 0,
                source_cell: 3,
                destination_street: 0,
                destination_lane: 1,
                destination_cell: 5,
            },
            weight: 0.0,
        }))
        .unwrap();
    map.model_mut().toggle_vehicle(CellRef {
        street: 0,
        lane: 0,
        index: 3,
    });
    for _ in 0..3 {
        map.model_mut().tick();
    }
    assert_eq!(
        map.model().streets()[0].cells(),
        [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    );
}
