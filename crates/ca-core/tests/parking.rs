use ca_core::{
    cell_index::CellRef,
    parking::{ParkingConfig, ParkingPair},
    traffic::{Calle, CalleConfig, CalleType, TrafficModel},
};

fn endpoint(index: usize) -> CellRef {
    CellRef {
        street: 0,
        lane: 0,
        index,
    }
}

fn config() -> ParkingConfig {
    ParkingConfig {
        capacity: 2,
        pairs: vec![ParkingPair {
            entrance: endpoint(1),
            exit: endpoint(5),
        }],
        entry_probabilities: [1.; 24],
        exit_probabilities: [0.; 24],
    }
}

#[test]
fn entering_vehicle_is_not_copied_downstream() {
    let street = Calle::new(
        CalleConfig::new(1, 8, CalleType::Conexion),
        vec![3, 0, 0, 0, 0, 0, 0, 0],
    )
    .unwrap();
    let mut model = TrafficModel::new(vec![street], 42);
    model.configure_parking(0, Some(config())).unwrap();
    model.tick();
    assert_eq!(model.parking(0).unwrap().occupied(), 1);
    assert_eq!(model.streets()[0].cells(), &[0; 8]);
}

#[test]
fn configuration_is_atomic_and_endpoints_have_one_owner() {
    let street = Calle::new(CalleConfig::new(1, 8, CalleType::Conexion), vec![0; 8]).unwrap();
    let mut model = TrafficModel::new(vec![street], 42);
    model.configure_parking(0, Some(config())).unwrap();
    assert_eq!(
        model
            .configure_parking(1, Some(config()))
            .unwrap_err()
            .translation_key(),
        "parking.validation.endpointOwned"
    );
    let mut invalid = config();
    invalid.pairs[0].exit = endpoint(100);
    assert!(model.configure_parking(0, Some(invalid)).is_err());
    assert_eq!(model.parking(0).unwrap().config, config());
    model.configure_parking(0, None).unwrap();
    model.configure_parking(1, Some(config())).unwrap();
}

#[test]
fn closed_two_direction_network_conserves_population_and_capacity() {
    use ca_core::traffic::LaneDirection;
    for reverse in [false, true] {
        let mut road = CalleConfig::new(1, 8, CalleType::Conexion);
        road.periodic = true;
        road.lane_directions = vec![Some(if reverse {
            LaneDirection::Reverse
        } else {
            LaneDirection::Forward
        })];
        let street = Calle::new(road, vec![1, 0, 2, 0, 3, 0, 4, 0]).unwrap();
        let mut model = TrafficModel::new(vec![street], 42);
        let mut parking = config();
        parking.entry_probabilities = [0.7; 24];
        parking.exit_probabilities = [0.4; 24];
        model.configure_parking(0, Some(parking)).unwrap();
        let mut saw_parked = false;
        for _ in 0..2000 {
            model.tick();
            let occupied = model.parking(0).unwrap().occupied();
            saw_parked |= occupied > 0;
            assert!(occupied <= 2);
            assert_eq!(
                model.streets()[0]
                    .cells()
                    .iter()
                    .filter(|v| (1..=6).contains(*v))
                    .count()
                    + occupied,
                4
            );
        }
        assert!(saw_parked);
    }
}

#[test]
fn map_parking_survives_save_but_not_scenario_occupancy_or_deletion() {
    use ca_core::{buildings::Building, map_json::MapDocument, virtual_time::Clock};
    let mut document = MapDocument::demo();
    let a = document
        .add_building(Building::rectangle([0.; 2], [10.; 2]))
        .unwrap();
    document.configure_parking(a, Some(config())).unwrap();
    let saved = document.to_json();
    let mut loaded = MapDocument::parse(&saved).unwrap();
    assert_eq!(loaded.model().parking(a).unwrap().config, config());
    loaded.model_mut().toggle_vehicle(endpoint(1));
    loaded.tick();
    assert_eq!(loaded.model().parking(a).unwrap().occupied(), 1);
    loaded.reset_scenario_time(Clock::default());
    assert_eq!(loaded.model().parking(a).unwrap().occupied(), 0);
    assert!(loaded.delete_building(a));
    assert!(loaded.model().parking(a).is_none());
    let b = loaded
        .add_building(Building::rectangle([0.; 2], [10.; 2]))
        .unwrap();
    loaded.configure_parking(b, Some(config())).unwrap();
    loaded.tick();
}

#[test]
fn adjacent_entrances_cannot_consume_the_same_snapshot_source_twice() {
    let street = Calle::new(
        CalleConfig::new(1, 8, CalleType::Conexion),
        vec![0, 4, 0, 0, 0, 0, 0, 0],
    )
    .unwrap();
    let mut model = TrafficModel::new(vec![street], 42);
    let mut parking = config();
    parking.pairs.push(ParkingPair {
        entrance: endpoint(2),
        exit: endpoint(6),
    });
    model.configure_parking(0, Some(parking)).unwrap();
    model.tick();
    assert_eq!(model.parking(0).unwrap().occupied(), 1);
    assert_eq!(model.streets()[0].cells(), &[0; 8]);
}

#[test]
fn ordinary_closed_links_conserve_vehicles_with_parking() {
    use ca_core::connections::{Connection, Mapping};
    let street = Calle::new(
        CalleConfig::new(1, 8, CalleType::Conexion),
        vec![1, 0, 2, 0, 3, 0, 4, 0],
    )
    .unwrap();
    let mut model = TrafficModel::new(vec![street], 42);
    model
        .add_connection(Connection::Lineal(Mapping {
            source_street: 0,
            source_lane: 0,
            source_cell: -1,
            destination_street: 0,
            destination_lane: 0,
            destination_cell: 0,
        }))
        .unwrap();
    let mut parking = config();
    parking.exit_probabilities = [0.5; 24];
    model.configure_parking(0, Some(parking)).unwrap();
    for _ in 0..2000 {
        model.tick();
        assert_eq!(
            model.streets()[0]
                .cells()
                .iter()
                .filter(|v| (1..=6).contains(*v))
                .count()
                + model.parking(0).unwrap().occupied(),
            4
        );
    }
}

#[test]
fn map_tick_samples_the_virtual_hour_and_never_saves_live_occupancy() {
    use ca_core::{buildings::Building, map_json::MapDocument, virtual_time::Clock};
    let mut map = MapDocument::demo();
    map.model_mut().clear_vehicles();
    let index = map
        .add_building(Building::rectangle([0.; 2], [10.; 2]))
        .unwrap();
    let mut parking = config();
    parking.entry_probabilities = [0.; 24];
    parking.entry_probabilities[12] = 1.;
    map.configure_parking(index, Some(parking)).unwrap();
    map.reset_scenario_time(Clock::new(1, 11, 0, 0).unwrap());
    map.model_mut().toggle_vehicle(endpoint(1));
    map.tick();
    assert_eq!(map.model().parking(index).unwrap().occupied(), 0);
    map.reset_scenario_time(Clock::new(1, 12, 0, 0).unwrap());
    map.model_mut().toggle_vehicle(endpoint(1));
    map.tick();
    assert_eq!(map.model().parking(index).unwrap().occupied(), 1);
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(loaded.model().parking(index).unwrap().occupied(), 0);
}

#[test]
fn resizing_and_deleting_streets_prune_complete_pairs_and_remap_survivors() {
    use ca_core::{
        buildings::Building,
        map_json::MapDocument,
        streets::{StreetChange, StreetEdit},
    };
    let mut map = MapDocument::demo();
    let index = map
        .add_building(Building::rectangle([0.; 2], [10.; 2]))
        .unwrap();
    let mut parking = config();
    parking.pairs.push(ParkingPair {
        entrance: CellRef {
            street: 1,
            lane: 0,
            index: 2,
        },
        exit: CellRef {
            street: 1,
            lane: 0,
            index: 4,
        },
    });
    map.configure_parking(index, Some(parking)).unwrap();
    map.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Dimensions {
            lanes: 1,
            length: 4,
        },
    ))
    .unwrap();
    assert_eq!(map.model().parking(index).unwrap().config.pairs.len(), 1);
    map.delete_street(0);
    assert_eq!(
        map.model().parking(index).unwrap().config.pairs[0]
            .entrance
            .street,
        0
    );
    map.update_building(index, map.buildings()[index].moved([10., 0.]))
        .unwrap();
    let saved = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(
        saved.model().parking(index).unwrap().config.pairs[0]
            .exit
            .index,
        4
    );
    map.delete_street(0);
    assert!(map.model().parking(index).is_none());
    assert!(
        MapDocument::parse(&map.to_json())
            .unwrap()
            .model()
            .parking(index)
            .is_none()
    );
}

#[test]
fn exits_spawn_once_and_wait_until_the_next_update_to_move() {
    let street = Calle::new(
        CalleConfig::new(1, 8, CalleType::Conexion),
        vec![3, 0, 0, 0, 0, 0, 0, 0],
    )
    .unwrap();
    let mut model = TrafficModel::new(vec![street], 42);
    model.configure_parking(0, Some(config())).unwrap();
    model.tick();
    let mut release = config();
    release.entry_probabilities = [0.; 24];
    release.exit_probabilities = [1.; 24];
    model.configure_parking(0, Some(release)).unwrap();
    model.tick();
    assert_eq!(model.parking(0).unwrap().occupied(), 0);
    assert!((1..=6).contains(&model.streets()[0].cells()[5]));
    assert_eq!(model.streets()[0].cells()[6], 0);
    model.tick();
    assert_eq!(model.streets()[0].cells()[5], 0);
    assert!((1..=6).contains(&model.streets()[0].cells()[6]));
}

#[test]
fn invalid_candidates_do_not_release_endpoints_or_change_occupancy() {
    let street = Calle::new(
        CalleConfig::new(1, 8, CalleType::Conexion),
        vec![1, 2, 0, 0, 0, 0, 0, 0],
    )
    .unwrap();
    let mut model = TrafficModel::new(vec![street], 42);
    model.configure_parking(0, Some(config())).unwrap();
    for _ in 0..3 {
        model.tick();
    }
    assert_eq!(model.parking(0).unwrap().occupied(), 2);
    for (mut invalid, reason) in [
        (config(), "parking.validation.capacityPositive"),
        (config(), "parking.validation.capacityBelowOccupancy"),
        (config(), "parking.validation.pairCount"),
        (config(), "parking.validation.duplicateEndpoint"),
        (config(), "parking.validation.entranceEndpointInvalid"),
    ] {
        match reason {
            "parking.validation.capacityPositive" => invalid.capacity = 0,
            "parking.validation.capacityBelowOccupancy" => invalid.capacity = 1,
            "parking.validation.pairCount" => invalid.pairs.clear(),
            "parking.validation.duplicateEndpoint" => invalid.pairs[0].exit = endpoint(1),
            _ => invalid.pairs[0].entrance.lane = 1,
        }
        assert_eq!(
            model
                .configure_parking(0, Some(invalid))
                .unwrap_err()
                .translation_key(),
            reason
        );
        assert_eq!(model.parking(0).unwrap().occupied(), 2);
        assert_eq!(model.parking(0).unwrap().config, config());
    }
    model.configure_parking(0, None).unwrap();
    model.configure_parking(1, Some(config())).unwrap();
    assert_eq!(model.parking(1).unwrap().occupied(), 0);
}

#[test]
fn duplicate_street_names_keep_physical_parking_addresses_on_reload() {
    use ca_core::{
        buildings::Building,
        map_json::MapDocument,
        streets::{StreetChange, StreetEdit},
    };
    let mut map = MapDocument::demo();
    let name = map.layout()[0].name.clone();
    map.edit_streets(StreetEdit::Update(1, StreetChange::Name(name)))
        .unwrap();
    let building = map
        .add_building(Building::rectangle([0.; 2], [10.; 2]))
        .unwrap();
    let mut parking = config();
    parking.pairs[0].entrance.street = 1;
    parking.pairs[0].exit.street = 1;
    map.configure_parking(building, Some(parking.clone()))
        .unwrap();
    let loaded = MapDocument::parse(&map.to_json()).unwrap();
    assert_eq!(loaded.model().parking(building).unwrap().config, parking);
}

#[test]
fn v1_name_based_pairs_load_with_default_curves_and_reject_incomplete_pairs() {
    use ca_core::map_json::MapDocument;
    use serde_json::json;
    let mut value: serde_json::Value =
        serde_json::from_str(&MapDocument::demo().to_json()).unwrap();
    value["edificios"] = json!([{
        "label": "Parking", "x": 0, "y": 0, "width": 10, "height": 10,
        "esEstacionamiento": true, "capacidadMaxima": 8, "vehiculosActuales": 7,
        "conexiones": [
            {"tipo": "entrada", "calleId": "Generador", "carril": 0, "indice": 1},
            {"tipo": "salida", "calleId": "Conexion", "carril": 1, "indice": 5}
        ]
    }]);
    let map = MapDocument::parse(&value.to_string()).unwrap();
    let parking = map.model().parking(0).unwrap();
    assert_eq!(parking.config.capacity, 8);
    assert_eq!(parking.config.entry_probabilities, [0.3; 24]);
    assert_eq!(parking.config.exit_probabilities, [0.2; 24]);
    assert_eq!(
        parking.config.pairs[0].exit,
        CellRef {
            street: 1,
            lane: 1,
            index: 5
        }
    );
    assert_eq!(parking.occupied(), 0);
    value["edificios"][0]["conexiones"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert!(MapDocument::parse(&value.to_string()).is_err());
}
