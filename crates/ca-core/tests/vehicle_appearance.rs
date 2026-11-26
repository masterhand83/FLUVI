use ca_core::{
    cell_index::CellRef,
    traffic::{Calle, CalleConfig, CalleType, LaneDirection, TrafficModel},
};

fn street(cells: Vec<u8>, reverse: bool, periodic: bool) -> Calle {
    let mut config = CalleConfig::new(1, cells.len(), CalleType::Conexion);
    config.periodic = periodic;
    config.lane_directions = vec![Some(if reverse {
        LaneDirection::Reverse
    } else {
        LaneDirection::Forward
    })];
    Calle::new(config, cells).unwrap()
}

#[test]
fn appearances_follow_forward_reverse_and_wrapped_vehicles() {
    for (reverse, periodic, source, destination) in [
        (false, false, 1, 2),
        (true, false, 2, 1),
        (false, true, 3, 0),
        (true, true, 0, 3),
    ] {
        let mut cells = vec![0; 4];
        cells[source] = 4;
        let mut road = street(cells, reverse, periodic);
        let appearance = road.vehicle_appearances()[source];
        road.update();
        assert_eq!(road.cells()[destination], 4);
        assert_eq!(road.cells()[source], 0);
        assert_eq!(road.vehicle_appearances()[destination], appearance);
    }
}

#[test]
fn creation_assigns_both_shapes_and_all_tints_without_changing_traffic_classes() {
    let mut model = TrafficModel::new(vec![street(vec![0; 512], false, false)], 42);
    model.random_fill(1.0).unwrap();
    let appearances = model.streets()[0].vehicle_appearances();
    for id in 1..=12 {
        assert!(appearances.contains(&id), "missing appearance {id}");
    }
    assert!(
        model.streets()[0]
            .cells()
            .iter()
            .all(|v| (1..=6).contains(v))
    );
    let before = appearances[0];
    let cell = CellRef {
        street: 0,
        lane: 0,
        index: 0,
    };
    for _ in 0..32 {
        model.toggle_vehicle(cell);
        model.toggle_vehicle(cell);
        if model.streets()[0].vehicle_appearances()[0] != before {
            return;
        }
    }
    panic!("new vehicles kept the old appearance");
}

#[test]
fn connection_transfer_keeps_the_source_appearance() {
    use ca_core::traffic::connections::{Connection, Mapping};
    let source = street(vec![0, 0, 5], false, false);
    let appearance = source.vehicle_appearances()[2];
    let mut model = TrafficModel::new(vec![source, street(vec![0; 3], false, false)], 10);
    model
        .add_connection(Connection::Lineal(Mapping {
            source_street: 0,
            source_lane: 0,
            source_cell: -1,
            destination_street: 1,
            destination_lane: 0,
            destination_cell: 0,
        }))
        .unwrap();
    model.tick();
    let target = &model.streets()[1];
    let position = target.cells().iter().position(|&v| v == 5).unwrap();
    assert_eq!(target.vehicle_appearances()[position], appearance);
}

#[test]
fn lane_changes_keep_appearance_and_do_not_advance_the_arrival_twice() {
    let mut config = CalleConfig::new(2, 5, CalleType::Conexion);
    config.lane_change_probability = 1.0;
    let source = Calle::new(config, vec![0, 3, 0, 0, 0, 0, 0, 0, 0, 0]).unwrap();
    let appearance = source.vehicle_appearances()[1];
    let mut model = TrafficModel::new(vec![source], 42);
    model.tick();
    assert_eq!(model.streets()[0].cells(), [0, 0, 0, 0, 0, 0, 0, 3, 0, 0]);
    assert_eq!(model.streets()[0].vehicle_appearances()[7], appearance);
}
