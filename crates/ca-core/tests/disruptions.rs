use ca_core::{
    cell_index::CellRef,
    disruptions::{Disruption, ScenarioAction},
    traffic::{Calle, CalleConfig, CalleType, TrafficModel},
};

fn model(cells: Vec<u8>) -> TrafficModel {
    TrafficModel::new(
        vec![Calle::new(CalleConfig::new(1, cells.len(), CalleType::Conexion), cells).unwrap()],
        42,
    )
}

#[test]
fn instant_flood_is_additive_counts_all_cells_and_preserves_occupied_cells() {
    let mut traffic = model(vec![1, 2, 7, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq!(
        traffic.disrupt(ScenarioAction::InstantFlood(25)).unwrap(),
        3
    );
    assert_eq!(&traffic.streets()[0].cells()[..3], &[1, 2, 7]);
    assert_eq!(
        traffic.disrupt(ScenarioAction::InstantFlood(100)).unwrap(),
        4
    );
    assert_eq!(
        traffic.disrupt(ScenarioAction::InstantFlood(100)).unwrap(),
        0
    );
    assert_eq!(
        traffic.streets()[0]
            .cells()
            .iter()
            .filter(|&&c| c == 7)
            .count(),
        8
    );
    let mark = traffic.disruption(CellRef {
        street: 0,
        lane: 0,
        index: 3,
    });
    assert_eq!(mark, Some(Disruption::Flood));
}

#[test]
fn rain_runs_after_street_update_and_selects_streets_not_weighted_by_size() {
    use ca_core::traffic::TickPhase;
    let mut traffic = TrafficModel::new(
        [1, 100]
            .into_iter()
            .map(|n| Calle::new(CalleConfig::new(1, n, CalleType::Conexion), vec![0; n]).unwrap())
            .collect(),
        71,
    );
    traffic.set_rain(true, 1.0).unwrap();
    let mut small = 0;
    for _ in 0..10_000 {
        traffic.tick_with_hook(|phase, streets| {
            if phase == TickPhase::StreetUpdate {
                assert!(streets.iter().all(|s| s.cells().iter().all(|&v| v == 0)));
            }
        });
        small += usize::from(traffic.streets()[0].cells()[0] == 7);
        traffic.disrupt(ScenarioAction::Clear).unwrap();
    }
    assert!(
        (4_800..=5_200).contains(&small),
        "small street selected {small} times"
    );
    traffic.set_rain(false, 1.0).unwrap();
    traffic.tick();
    assert!(
        traffic
            .streets()
            .iter()
            .all(|s| s.cells().iter().all(|&v| v == 0))
    );
}

#[test]
fn painting_and_clearing_keep_vehicles_and_parking_endpoints() {
    use ca_core::parking::{ParkingConfig, ParkingPair};
    let mut traffic = model(vec![1, 2, 3, 4, 5, 6, 7, 0, 0, 0]);
    let cell = |index| CellRef {
        street: 0,
        lane: 0,
        index,
    };
    traffic
        .configure_parking(
            0,
            Some(ParkingConfig::new(
                10,
                vec![ParkingPair {
                    entrance: cell(8),
                    exit: cell(9),
                }],
            )),
        )
        .unwrap();
    for index in 0..10 {
        let changed = traffic
            .disrupt(ScenarioAction::Paint(cell(index), Disruption::Tree))
            .unwrap();
        assert_eq!(changed, usize::from(index == 7));
    }
    assert_eq!(
        traffic.disrupt(ScenarioAction::InstantFlood(100)).unwrap(),
        0
    );
    traffic.set_rain(true, 1.).unwrap();
    // No rain-eligible cells; use a full sink-free street so vehicles remain.
    assert_eq!(traffic.disrupt(ScenarioAction::Clear).unwrap(), 2);
    assert_eq!(
        traffic.streets()[0].cells(),
        &[1, 2, 3, 4, 5, 6, 0, 0, 0, 0]
    );
    assert_eq!(traffic.disruption(cell(7)), None);
}

#[test]
fn dimensions_and_deletion_keep_only_surviving_marks() {
    use ca_core::{
        map_json::MapDocument,
        streets::{StreetChange, StreetEdit},
    };
    let mut map = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"A","tipo":"conexion","tamano":8,"carriles":2},
        {"nombre":"B","tipo":"conexion","tamano":8}]}"#,
    )
    .unwrap();
    for (street, lane, index) in [(0, 0, 2), (0, 1, 6), (1, 0, 1)] {
        map.model_mut()
            .disrupt(ScenarioAction::Paint(
                CellRef {
                    street,
                    lane,
                    index,
                },
                Disruption::Cone,
            ))
            .unwrap();
    }
    map.edit_streets(StreetEdit::Update(
        0,
        StreetChange::Dimensions {
            lanes: 1,
            length: 4,
        },
    ))
    .unwrap();
    assert_eq!(
        map.model().disruption(CellRef {
            street: 0,
            lane: 0,
            index: 2
        }),
        Some(Disruption::Cone)
    );
    assert_eq!(
        map.model().disruption(CellRef {
            street: 0,
            lane: 1,
            index: 6
        }),
        None
    );
    map.delete_street(0);
    assert_eq!(
        map.model().disruption(CellRef {
            street: 0,
            lane: 0,
            index: 1
        }),
        Some(Disruption::Cone)
    );
}

#[test]
fn presets_leave_a_free_lane_and_use_five_percent_potholes_without_removing_traffic() {
    let mut traffic = TrafficModel::new(
        vec![
            Calle::new(
                CalleConfig::new(3, 4, CalleType::Conexion),
                vec![1, 0, 0, 0, 2, 0, 0, 0, 7, 0, 0, 0],
            )
            .unwrap(),
        ],
        17,
    );
    assert_eq!(traffic.disrupt(ScenarioAction::MassFlood).unwrap(), 7);
    assert_eq!(
        traffic.streets()[0].cells(),
        &[1, 0, 0, 0, 2, 7, 7, 7, 7, 7, 7, 7]
    );
    let mut traffic = model(vec![0; 100_000]);
    let count = traffic.disrupt(ScenarioAction::RandomPotholes).unwrap();
    assert!((4_700..=5_300).contains(&count), "{count}");
    let marks = (0..100_000)
        .filter(|&index| {
            traffic.disruption(CellRef {
                street: 0,
                lane: 0,
                index,
            }) == Some(Disruption::Pothole)
        })
        .count();
    assert_eq!(marks, count);
}

#[test]
fn rain_avoids_full_streets_and_parking_and_keeps_existing_floods_when_stopped() {
    use ca_core::parking::{ParkingConfig, ParkingPair};
    let mut traffic = TrafficModel::new(
        vec![
            Calle::new(CalleConfig::new(1, 1, CalleType::Conexion), vec![7]).unwrap(),
            Calle::new(CalleConfig::new(1, 4, CalleType::Conexion), vec![0; 4]).unwrap(),
        ],
        42,
    );
    let cell = |index| CellRef {
        street: 1,
        lane: 0,
        index,
    };
    traffic
        .configure_parking(
            0,
            Some(ParkingConfig::new(
                10,
                vec![ParkingPair {
                    entrance: cell(0),
                    exit: cell(3),
                }],
            )),
        )
        .unwrap();
    traffic.set_rain(true, 1.).unwrap();
    for _ in 0..5 {
        traffic.tick();
    }
    assert_eq!(traffic.streets()[0].cells(), &[7]);
    assert_eq!(traffic.streets()[1].cells(), &[0, 7, 7, 0]);
    traffic.set_rain(false, 1.).unwrap();
    traffic.tick();
    assert_eq!(traffic.streets()[1].cells(), &[0, 7, 7, 0]);
    traffic.disrupt(ScenarioAction::Clear).unwrap();
    traffic.set_rain(true, 0.).unwrap();
    for _ in 0..100 {
        traffic.tick();
    }
    assert_eq!(traffic.streets()[1].cells(), &[0, 0, 0, 0]);
}

#[test]
fn instant_flood_uses_the_ticket_count_for_small_maps_and_rejects_invalid_percentages() {
    let mut traffic = model(vec![0; 3]);
    assert_eq!(traffic.disrupt(ScenarioAction::InstantFlood(1)).unwrap(), 0);
    assert_eq!(
        traffic.disrupt(ScenarioAction::InstantFlood(50)).unwrap(),
        2
    );
    assert!(traffic.disrupt(ScenarioAction::InstantFlood(0)).is_err());
    assert!(traffic.disrupt(ScenarioAction::InstantFlood(101)).is_err());
    assert!(traffic.set_rain(true, f64::NAN).is_err());
    assert!(traffic.set_rain(true, 1.01).is_err());
}
