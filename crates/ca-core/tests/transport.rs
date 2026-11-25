use ca_core::traffic::{Calle, CalleConfig, CalleType, LaneDirection, TickPhase, TrafficModel};

#[test]
fn lane_changes_match_v1_oracle() {
    for line in include_str!("fixtures/lane-changes.csv").lines().skip(1) {
        let parts: Vec<_> = line.split(',').collect();
        let config = CalleConfig {
            lane_change_probability: parts[2].parse().unwrap(),
            lane_directions: parts[3]
                .chars()
                .map(|d| {
                    Some(if d == 'F' {
                        LaneDirection::Forward
                    } else {
                        LaneDirection::Reverse
                    })
                })
                .collect(),
            ..CalleConfig::new(3, 5, CalleType::Conexion)
        };
        let mut street = Calle::new(config, parts[5].bytes().map(|v| v - b'0').collect()).unwrap();
        if let Ok(waiting) = parts[4].parse::<usize>() {
            assert!(street.set_waiting(waiting / 5, waiting % 5, true));
        }
        let mut model = TrafficModel::new(vec![street], parts[1].parse().unwrap());
        model.tick_with_hook(|phase, streets| {
            if phase == TickPhase::LaneChanges {
                let expected: Vec<_> = parts[6].bytes().map(|v| v - b'0').collect();
                assert_eq!(streets[0].cells(), expected, "{line}");
            }
            if phase == TickPhase::StreetUpdate {
                let expected: Vec<_> = parts[7].bytes().map(|v| v - b'0').collect();
                assert_eq!(streets[0].cells(), expected, "{line}");
                // A second CA update must not retain the previous waiting flags.
                let mut street = streets[0].clone();
                street.update();
                let expected: Vec<_> = parts[8].bytes().map(|v| v - b'0').collect();
                assert_eq!(street.cells(), expected, "{line}");
            }
        });
    }
}

#[test]
fn closed_streets_conserve_each_vehicle_class() {
    let config = CalleConfig {
        lane_change_probability: 0.8,
        ..CalleConfig::new(3, 8, CalleType::Conexion)
    };
    let street = Calle::new(
        config,
        vec![
            7, 1, 0, 2, 0, 0, 0, 7, 7, 0, 3, 0, 4, 0, 0, 7, 7, 5, 0, 0, 0, 6, 0, 7,
        ],
    )
    .unwrap();
    let mut model = TrafficModel::new(vec![street], 42);
    for _ in 0..200 {
        model.tick_with_hook(|_, streets| {
            for vehicle in 1..=6 {
                assert_eq!(
                    streets[0].cells().iter().filter(|&&v| v == vehicle).count(),
                    1
                );
            }
            assert_eq!(streets[0].cells().iter().filter(|&&v| v == 7).count(), 6);
        });
    }
}

#[test]
fn clear_and_random_fill_preserve_blockers_and_existing_vehicles() {
    let street = Calle::new(
        CalleConfig::new(1, 10, CalleType::Conexion),
        vec![7, 1, 2, 3, 4, 5, 6, 0, 0, 7],
    )
    .unwrap();
    let mut model = TrafficModel::new(vec![street], 42);
    model.random_fill(0.0).unwrap();
    assert_eq!(model.streets()[0].cells(), &[7, 1, 2, 3, 4, 5, 6, 0, 0, 7]);
    model.random_fill(1.0).unwrap();
    assert_eq!(&model.streets()[0].cells()[..7], &[7, 1, 2, 3, 4, 5, 6]);
    assert!(
        model.streets()[0].cells()[7..9]
            .iter()
            .all(|v| (1..=6).contains(v))
    );
    model.clear_vehicles();
    assert_eq!(model.streets()[0].cells(), &[7, 0, 0, 0, 0, 0, 0, 0, 0, 7]);
    for invalid in [-0.1, 1.1, f64::NAN, f64::INFINITY] {
        assert!(model.random_fill(invalid).is_err());
    }
}

#[test]
fn generation_override_is_session_only_and_precedes_hourly_multiplier() {
    let streets = [0.0, 1.0].map(|probability| {
        Calle::new(
            CalleConfig {
                generation_probability: probability,
                lane_generation_enabled: vec![None, Some(false)],
                ..CalleConfig::new(2, 1, CalleType::Generador)
            },
            vec![0; 2],
        )
        .unwrap()
    });
    let mut model = TrafficModel::new(streets.to_vec(), 42);
    model.set_generation_override(Some(1.0)).unwrap();
    model.set_hourly_multiplier(0.0).unwrap();
    model.tick();
    assert_eq!(model.streets()[0].cells(), &[0, 0]);
    assert_eq!(model.streets()[1].cells(), &[0, 0]);
    model.set_hourly_multiplier(2.0).unwrap();
    // 0.5 * 2 must spawn with certainty, not stored probability * 2.
    model.set_generation_override(Some(0.5)).unwrap();
    model.tick();
    for street in model.streets() {
        assert!((1..=6).contains(&street.cells()[0]));
        assert_eq!(street.cells()[1], 0);
    }
    model.clear_vehicles();
    model.set_generation_override(None).unwrap();
    model.tick();
    assert_eq!(model.streets()[0].cells(), &[0, 0]);
    assert!((1..=6).contains(&model.streets()[1].cells()[0]));
    assert_eq!(model.streets()[0].config().generation_probability, 0.0);
    assert_eq!(model.streets()[1].config().generation_probability, 1.0);
    for probability in [f64::NAN, -1.0, 1.1] {
        assert!(model.set_generation_override(Some(probability)).is_err());
    }
    for multiplier in [f64::NAN, f64::INFINITY, -1.0] {
        assert!(model.set_hourly_multiplier(multiplier).is_err());
    }
}
