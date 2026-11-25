use ca_core::connections::{Connection, ConnectionError, Mapping, MergeRow, WeightedRow};
use ca_core::traffic::{Calle, CalleConfig, CalleType, LaneDirection, TickPhase, TrafficModel};

fn street(cells: &[u8]) -> Calle {
    Calle::new(
        CalleConfig::new(1, cells.len(), CalleType::Conexion),
        cells.to_vec(),
    )
    .unwrap()
}

#[test]
fn demo_connects_both_lane_directions_across_all_three_streets() {
    let model = TrafficModel::demo();
    assert_eq!(model.connections().len(), 4);
    let mut model = model;
    model.clear_vehicles();
    model.set_generation_override(Some(0.0)).unwrap();
    model.toggle_vehicle(ca_core::cell_index::CellRef {
        street: 0,
        lane: 0,
        index: 31,
    });
    model.toggle_vehicle(ca_core::cell_index::CellRef {
        street: 0,
        lane: 1,
        index: 0,
    });
    model.transfer_connections();
    assert_eq!(model.streets()[0].cells()[31], 0);
    assert_eq!(model.streets()[0].cells()[32], 0);
    assert_eq!(model.streets()[1].cells()[0], 1);
    assert_eq!(model.streets()[1].cells()[63], 1);
}

fn mapping(source_cell: isize, destination_cell: usize) -> Mapping {
    Mapping {
        source_street: 0,
        source_lane: 0,
        source_cell,
        destination_street: 1,
        destination_lane: 0,
        destination_cell,
    }
}

#[test]
fn linear_transfer_runs_before_street_update_and_conserves_vehicle() {
    let mut model = TrafficModel::new(vec![street(&[0, 0, 4]), street(&[0, 0, 0])], 42);
    model
        .add_connection(Connection::Lineal(mapping(-1, 0)))
        .unwrap();
    model.tick_with_hook(|phase, streets| {
        if phase == TickPhase::Generation {
            assert_eq!(streets[0].cells(), &[0, 0, 4]);
        }
        if phase == TickPhase::ConnectionTransfers {
            assert_eq!(streets[0].cells(), &[0, 0, 0]);
            assert_eq!(streets[1].cells(), &[4, 0, 0]);
            assert_eq!(
                streets
                    .iter()
                    .flat_map(|s| s.cells())
                    .filter(|&&v| (1..=6).contains(&v))
                    .count(),
                1
            );
        }
    });
}

#[test]
fn merge_enabled_rows_and_reverse_physical_cells_match_hand_computed_result() {
    let reverse = Calle::new(
        CalleConfig {
            lane_directions: vec![Some(LaneDirection::Reverse)],
            ..CalleConfig::new(1, 3, CalleType::Conexion)
        },
        vec![5, 0, 0],
    )
    .unwrap();
    let mut model = TrafficModel::new(vec![reverse, street(&[0, 0, 0]), street(&[0, 0, 6])], 42);
    model
        .add_connection(Connection::Incorporacion(vec![
            MergeRow {
                mapping: Mapping {
                    source_street: 2,
                    ..mapping(-1, 1)
                },
                enabled: false,
            },
            MergeRow {
                mapping: mapping(0, 1),
                enabled: true,
            },
        ]))
        .unwrap();
    model.transfer_connections();
    assert_eq!(model.streets()[0].cells(), &[0, 0, 0]);
    assert_eq!(model.streets()[1].cells(), &[0, 5, 0]);
    assert_eq!(model.streets()[2].cells(), &[0, 0, 6]);
}

#[test]
fn blockers_occupied_destinations_and_waiting_sources_do_not_transfer() {
    for value in 1..=7 {
        let mut source = street(&[0, 0, value]);
        source.set_waiting(0, 2, true);
        let mut model = TrafficModel::new(vec![source, street(&[0, 0, 0])], 42);
        model
            .add_connection(Connection::Lineal(mapping(-1, 0)))
            .unwrap();
        model.transfer_connections();
        assert_eq!(model.streets()[0].cells(), &[0, 0, value]);
        assert_eq!(model.streets()[1].cells(), &[0, 0, 0]);
    }
    for destination in 1..=7 {
        let mut model =
            TrafficModel::new(vec![street(&[0, 0, 2]), street(&[destination, 0, 0])], 42);
        model
            .add_connection(Connection::Lineal(mapping(-1, 0)))
            .unwrap();
        model.tick_with_hook(|phase, streets| {
            if phase == TickPhase::ConnectionTransfers || phase == TickPhase::StreetUpdate {
                assert_eq!(streets[0].cells(), &[0, 0, 2]);
            }
        });
    }
}

#[test]
fn closed_two_street_ring_conserves_each_class_for_200_ticks() {
    let mut model = TrafficModel::new(vec![street(&[1, 0, 2, 0, 3]), street(&[4, 0, 5, 0, 6])], 42);
    model
        .add_connection(Connection::Lineal(mapping(-1, 0)))
        .unwrap();
    model
        .add_connection(Connection::Lineal(Mapping {
            source_street: 1,
            destination_street: 0,
            ..mapping(-1, 0)
        }))
        .unwrap();
    for _ in 0..200 {
        model.tick_with_hook(|_, streets| {
            for value in 1..=6 {
                assert_eq!(
                    streets
                        .iter()
                        .flat_map(|s| s.cells())
                        .filter(|&&v| v == value)
                        .count(),
                    1
                );
            }
        });
    }
}

fn split() -> Connection {
    Connection::Probabilistica(vec![
        WeightedRow {
            mapping: mapping(-1, 0),
            weight: 0.25,
        },
        WeightedRow {
            mapping: Mapping {
                destination_street: 2,
                ..mapping(-1, 0)
            },
            weight: 0.75,
        },
    ])
}

#[test]
fn seeded_split_selects_one_destination_and_matches_expected_proportions() {
    let mut model = TrafficModel::new(
        vec![street(&[0, 0, 3]), street(&[0, 0, 0]), street(&[0, 0, 0])],
        42,
    );
    model.add_connection(split()).unwrap();
    model.transfer_connections();
    // SplitMix64 seed 42's first roll is approximately 0.741565.
    assert_eq!(model.streets()[1].cells(), &[0, 0, 0]);
    assert_eq!(model.streets()[2].cells(), &[3, 0, 0]);
    let mut counts = [0; 2];
    for _ in 0..10_000 {
        model.clear_vehicles();
        model.toggle_vehicle(ca_core::cell_index::CellRef {
            street: 0,
            lane: 0,
            index: 2,
        });
        model.transfer_connections();
        for (count, street) in counts.iter_mut().zip(&model.streets()[1..]) {
            *count += usize::from(street.cells()[0] == 1);
        }
    }
    assert_eq!(counts.iter().sum::<usize>(), 10_000);
    assert!((counts[0] as isize - 2500).abs() < 200, "{counts:?}");
    assert!((counts[1] as isize - 7500).abs() < 200, "{counts:?}");
}

#[test]
fn registration_rejects_invalid_links_without_changing_network() {
    let mut model = TrafficModel::new(vec![street(&[0, 0, 0]), street(&[0, 0, 0])], 42);
    for invalid in [
        Mapping {
            source_street: 99,
            ..mapping(-1, 0)
        },
        Mapping {
            source_lane: 1,
            ..mapping(-1, 0)
        },
        Mapping {
            destination_lane: 1,
            ..mapping(-1, 0)
        },
        mapping(-2, 0),
        mapping(3, 0),
        mapping(0, 3),
    ] {
        assert_eq!(
            model.add_connection(Connection::Lineal(invalid)),
            Err(ConnectionError::InvalidMapping)
        );
    }
    assert_eq!(
        model.add_connection(Connection::Incorporacion(vec![MergeRow {
            mapping: mapping(-1, 0),
            enabled: false
        },])),
        Err(ConnectionError::NoActiveRows)
    );
    for weight in [0.5, -0.1, f64::NAN, f64::INFINITY] {
        assert_eq!(
            model.add_connection(Connection::Probabilistica(vec![WeightedRow {
                mapping: mapping(-1, 0),
                weight
            },])),
            Err(ConnectionError::Weights)
        );
    }
    assert_eq!(
        model.add_connection(Connection::Probabilistica(vec![
            WeightedRow {
                mapping: mapping(-1, 0),
                weight: 0.5
            },
            WeightedRow {
                mapping: mapping(1, 1),
                weight: 0.5
            },
        ])),
        Err(ConnectionError::SplitSource)
    );
    assert!(model.connections().is_empty());
    model
        .add_connection(Connection::Lineal(mapping(-1, 0)))
        .unwrap();
    assert_eq!(
        model.add_connection(Connection::Lineal(mapping(2, 0))),
        Err(ConnectionError::Duplicate)
    );
    assert_eq!(model.connections().len(), 1);
}

#[test]
fn legacy_weighted_split_requires_several_destinations() {
    let mut model = TrafficModel::new(vec![street(&[0, 0, 0]), street(&[0, 0, 0])], 42);
    assert_eq!(
        model.add_connection(Connection::Probabilistica(vec![WeightedRow {
            mapping: mapping(-1, 0),
            weight: 1.0,
        }])),
        Err(ConnectionError::Weights),
    );
    assert!(model.connections().is_empty());
}

#[test]
fn minus_one_is_physical_last_cell_not_reverse_exit() {
    let reverse = Calle::new(
        CalleConfig {
            lane_directions: vec![Some(LaneDirection::Reverse)],
            ..CalleConfig::new(1, 3, CalleType::Conexion)
        },
        vec![6, 0, 0],
    )
    .unwrap();
    assert_eq!(mapping(-1, 0).effective_source_cell(&reverse), Some(2));
    let mut model = TrafficModel::new(vec![reverse.clone(), reverse], 42);
    assert_eq!(
        model.add_connection(Connection::Lineal(mapping(-1, 2))),
        Err(ConnectionError::Direction)
    );
    assert_eq!(
        model.add_connection(Connection::Lineal(mapping(0, 0))),
        Err(ConnectionError::Direction)
    );
    model
        .add_connection(Connection::Lineal(mapping(0, 2)))
        .unwrap();
    model.transfer_connections();
    assert_eq!(model.streets()[0].cells(), &[0, 0, 0]);
    assert_eq!(model.streets()[1].cells(), &[6, 0, 6]);
}

#[test]
fn every_connection_type_leaves_blockers_in_place_without_waiting_flags() {
    for link in [
        Connection::Lineal(mapping(-1, 0)),
        Connection::Incorporacion(vec![MergeRow {
            mapping: mapping(-1, 0),
            enabled: true,
        }]),
        split(),
    ] {
        let mut model = TrafficModel::new(
            vec![street(&[0, 0, 7]), street(&[0, 0, 0]), street(&[0, 0, 0])],
            42,
        );
        model.add_connection(link).unwrap();
        model.transfer_connections();
        assert_eq!(model.streets()[0].cells(), &[0, 0, 7]);
        assert_eq!(model.streets()[1].cells(), &[0, 0, 0]);
        assert_eq!(model.streets()[2].cells(), &[0, 0, 0]);
    }
}

#[test]
fn split_does_not_reroute_when_selected_destination_is_occupied() {
    let mut model = TrafficModel::new(
        vec![street(&[0, 0, 6]), street(&[0, 0, 0]), street(&[7, 0, 0])],
        42,
    );
    model.add_connection(split()).unwrap();
    model.tick_with_hook(|phase, streets| {
        if phase == TickPhase::ConnectionTransfers || phase == TickPhase::StreetUpdate {
            assert_eq!(streets[0].cells(), &[0, 0, 6]);
            assert_eq!(streets[1].cells(), &[0, 0, 0]);
            assert_eq!(streets[2].cells(), &[7, 0, 0]);
        }
    });
}

#[test]
fn generation_precedes_transfers_and_merge_contention_keeps_losing_vehicle() {
    let source = Calle::new(
        CalleConfig {
            generation_probability: 1.0,
            ..CalleConfig::new(1, 3, CalleType::Generador)
        },
        vec![0, 0, 0],
    )
    .unwrap();
    let mut model = TrafficModel::new(vec![source, street(&[0, 0, 0])], 42);
    model
        .add_connection(Connection::Lineal(mapping(0, 0)))
        .unwrap();
    model.tick_with_hook(|phase, streets| {
        if phase == TickPhase::ConnectionTransfers {
            assert_eq!(streets[0].cells(), &[0, 0, 0]);
            assert_eq!(streets[1].cells(), &[1, 0, 0]);
        }
    });
    let mut model = TrafficModel::new(
        vec![street(&[0, 0, 2]), street(&[0, 0, 0]), street(&[0, 0, 5])],
        42,
    );
    model
        .add_connection(Connection::Incorporacion(vec![
            MergeRow {
                mapping: mapping(-1, 0),
                enabled: true,
            },
            MergeRow {
                mapping: Mapping {
                    source_street: 2,
                    ..mapping(-1, 0)
                },
                enabled: true,
            },
        ]))
        .unwrap();
    model.transfer_connections();
    assert_eq!(model.streets()[0].cells(), &[0, 0, 0]);
    assert_eq!(model.streets()[1].cells(), &[2, 0, 0]);
    assert_eq!(model.streets()[2].cells(), &[0, 0, 5]);
}
