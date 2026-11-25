use ca_core::traffic::{
    Calle, CalleConfig, CalleType, LaneDirection, TickPhase, TrafficModel, rule,
};

#[test]
fn rules_match_evaluated_v1_fixture() {
    let fixture = include_str!("fixtures/traffic-rules.csv");
    assert_eq!(
        fixture.lines().next(),
        Some("upstream,center,downstream,result")
    );
    let mut count = 0;
    for line in fixture.lines().skip(1) {
        let values: Vec<u8> = line.split(',').map(|v| v.parse().unwrap()).collect();
        assert_eq!(
            rule(values[0], values[1], values[2]),
            Some(values[3]),
            "{line}"
        );
        count += 1;
    }
    assert!(count > 400);
    assert_eq!(rule(7, 0, 0), None);
}

#[test]
fn mixed_direction_lanes_move_in_physical_coordinates() {
    let mut street = Calle::new(
        CalleConfig {
            lane_directions: vec![Some(LaneDirection::Forward), Some(LaneDirection::Reverse)],
            ..CalleConfig::new(2, 5, CalleType::Conexion)
        },
        vec![1, 0, 2, 0, 0, 0, 0, 3, 0, 4],
    )
    .unwrap();
    assert_eq!((street.entry_cell(0), street.exit_cell(0)), (0, 4));
    assert_eq!((street.entry_cell(1), street.exit_cell(1)), (4, 0));
    street.update();
    assert_eq!(street.cells(), &[0, 1, 0, 2, 0, 0, 3, 0, 4, 0]);
}

#[test]
fn devourers_remove_all_vehicle_types_but_obstructions_stay() {
    for vehicle in 1..=6 {
        for direction in [LaneDirection::Forward, LaneDirection::Reverse] {
            let mut config = CalleConfig::new(1, 4, CalleType::Devorador);
            config.lane_directions = vec![Some(direction)];
            let cells = if direction == LaneDirection::Forward {
                vec![7, vehicle, 0, 0]
            } else {
                vec![0, 0, vehicle, 7]
            };
            let mut street = Calle::new(config, cells).unwrap();
            street.update();
            let expected = if direction == LaneDirection::Forward {
                vec![7, 0, vehicle, 0]
            } else {
                vec![0, vehicle, 0, 7]
            };
            assert_eq!(street.cells(), expected);
            street.update();
            street.update();
            assert_eq!(street.cells().iter().filter(|&&v| v == 7).count(), 1);
            assert!(!street.cells().iter().any(|v| (1..=6).contains(v)));
        }
    }
    for direction in [LaneDirection::Forward, LaneDirection::Reverse] {
        let mut config = CalleConfig::new(1, 3, CalleType::Devorador);
        config.lane_directions = vec![Some(direction)];
        let cells = if direction == LaneDirection::Forward {
            vec![0, 1, 7]
        } else {
            vec![7, 1, 0]
        };
        let mut street = Calle::new(config, cells.clone()).unwrap();
        for _ in 0..5 {
            street.update();
        }
        assert_eq!(street.cells(), cells);
    }
}

#[test]
fn missing_rules_keep_the_center_and_one_cell_lanes_skip_ca() {
    // Neither 7,0,0 nor 7,2,3 is in the v1 table.
    assert_eq!(rule(7, 2, 3), None);
    let mut street = Calle::new(
        CalleConfig::new(1, 4, CalleType::Conexion),
        vec![7, 2, 3, 7],
    )
    .unwrap();
    street.update();
    assert_eq!(street.cells(), &[7, 2, 3, 7]);
    for tipo in [
        CalleType::Conexion,
        CalleType::Generador,
        CalleType::Devorador,
    ] {
        for value in 0..=7 {
            let mut street = Calle::new(CalleConfig::new(1, 1, tipo), vec![value]).unwrap();
            street.update();
            let expected = if tipo == CalleType::Devorador && (1..=6).contains(&value) {
                0
            } else {
                value
            };
            assert_eq!(street.cells(), &[expected]);
        }
    }
}

#[test]
fn generation_uses_only_empty_enabled_directional_entries() {
    let config = CalleConfig {
        generation_probability: 1.0,
        lane_directions: vec![None, Some(LaneDirection::Reverse), None, None, None, None],
        lane_generation_enabled: vec![None, Some(true), Some(false), None, None],
        ..CalleConfig::new(6, 3, CalleType::Generador)
    };
    let street = Calle::new(
        config,
        vec![0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 7, 0, 0, 0, 0, 0],
    )
    .unwrap();
    let mut model = TrafficModel::new(vec![street], 42);
    let mut generated = false;
    model.tick_with_hook(|phase, streets| {
        if phase != TickPhase::Generation {
            return;
        }
        generated = true;
        let cells = streets[0].cells();
        for entry in [0, 5, 15] {
            assert!((1..=6).contains(&cells[entry]));
        }
        assert_eq!(&cells[6..15], &[0, 0, 0, 4, 0, 0, 7, 0, 0]);
        for empty in [1, 2, 3, 4, 16, 17] {
            assert_eq!(cells[empty], 0);
        }
    });
    assert!(generated);
}

#[test]
fn seeded_ticks_match_v1_trajectories() {
    let fixture = include_str!("fixtures/traffic-trajectory.csv");
    for seed in [42, 43] {
        let config = CalleConfig {
            generation_probability: 0.45,
            lane_directions: vec![None, Some(LaneDirection::Reverse)],
            ..CalleConfig::new(2, 8, CalleType::Generador)
        };
        let street = Calle::new(config, vec![0; 16]).unwrap();
        let mut a = TrafficModel::new(vec![street.clone()], seed);
        let mut b = TrafficModel::new(vec![street], seed);
        let mut count = 0;
        for line in fixture.lines().skip(1) {
            let parts: Vec<_> = line.split(',').collect();
            if parts[0].parse::<u64>().unwrap() != seed {
                continue;
            }
            a.tick();
            b.tick();
            let expected: Vec<_> = parts[2].bytes().map(|value| value - b'0').collect();
            assert_eq!(a.streets()[0].cells(), expected, "{line}");
            assert_eq!(a.streets()[0].cells(), b.streets()[0].cells());
            count += 1;
        }
        assert_eq!(count, 20);
    }
}

#[test]
fn tick_hooks_follow_v1_order_and_idle_phases_do_not_change_cells() {
    let config = CalleConfig {
        generation_probability: 0.45,
        lane_change_probability: 1.0, // Lane changes are still a no-op.
        lane_directions: vec![None, Some(LaneDirection::Reverse)],
        ..CalleConfig::new(2, 8, CalleType::Generador)
    };
    let mut model = TrafficModel::new(vec![Calle::new(config, vec![0; 16]).unwrap()], 42);
    let mut phases = Vec::new();
    model.tick_with_hook(|phase, streets| {
        phases.push(phase);
        // First tick from the independently evaluated v1 trajectory, before/after CA.
        let expected: &[u8] = match phase {
            TickPhase::Generation | TickPhase::ConnectionTransfers | TickPhase::LaneChanges => {
                &[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]
            }
            _ => &[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0],
        };
        assert_eq!(streets[0].cells(), expected);
    });
    assert_eq!(
        phases,
        [
            TickPhase::Generation,
            TickPhase::ConnectionTransfers,
            TickPhase::LaneChanges,
            TickPhase::StreetUpdate,
            TickPhase::Rain,
            TickPhase::Clock,
            TickPhase::Metrics,
        ]
    );
}

#[test]
fn zero_probability_and_non_generators_never_spawn() {
    for (tipo, probability) in [
        (CalleType::Generador, 0.0),
        (CalleType::Conexion, 1.0),
        (CalleType::Devorador, 1.0),
    ] {
        let config = CalleConfig {
            generation_probability: probability,
            ..CalleConfig::new(2, 3, tipo)
        };
        let mut model = TrafficModel::new(vec![Calle::new(config, vec![0; 6]).unwrap()], 42);
        for _ in 0..30 {
            model.tick();
        }
        assert_eq!(model.streets()[0].cells(), &[0; 6]);
    }
}

#[test]
fn invalid_streets_are_rejected_at_construction() {
    for (lanes, size) in [(0, 1), (1, 0), (usize::MAX, 2)] {
        assert!(Calle::new(CalleConfig::new(lanes, size, CalleType::Conexion), vec![]).is_err());
    }
    for cells in [vec![], vec![0, 0], vec![8]] {
        assert!(Calle::new(CalleConfig::new(1, 1, CalleType::Conexion), cells).is_err());
    }
    for probability in [f64::NAN, f64::INFINITY, -0.1, 1.1] {
        for generation in [true, false] {
            let mut config = CalleConfig::new(1, 1, CalleType::Conexion);
            if generation {
                config.generation_probability = probability;
            } else {
                config.lane_change_probability = probability;
            }
            assert!(Calle::new(config, vec![0]).is_err());
        }
    }
    let mut config = CalleConfig::new(1, 1, CalleType::Conexion);
    config.lane_directions = vec![None, None];
    assert!(Calle::new(config, vec![0]).is_err());
    let mut config = CalleConfig::new(1, 1, CalleType::Conexion);
    config.lane_generation_enabled = vec![None, None];
    assert!(Calle::new(config, vec![0]).is_err());
}
