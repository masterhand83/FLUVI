use ca_core::{
    metrics::Metrics,
    traffic::{Calle, CalleConfig, CalleType, LaneDirection},
    virtual_time::Clock,
};

#[test]
fn matches_independent_v1_fixture_states() {
    let cases: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/metrics-v1.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let lanes = case["cells"].as_array().unwrap();
        let mut config = CalleConfig::new(
            lanes.len(),
            lanes[0].as_array().unwrap().len(),
            CalleType::Conexion,
        );
        config.lane_directions = case["directions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| {
                Some(if d == -1 {
                    LaneDirection::Reverse
                } else {
                    LaneDirection::Forward
                })
            })
            .collect();
        let cells = lanes
            .iter()
            .flat_map(|l| l.as_array().unwrap())
            .map(|v| v.as_u64().unwrap() as u8)
            .collect();
        let streets = vec![Calle::new(config, cells).unwrap()];
        let mut metrics = Metrics::new(&streets);
        metrics.update(&streets, Clock::default());
        for _ in 1..=60 {
            metrics.update(&streets, Clock::default());
        }
        let point = metrics.history().last().unwrap();
        let expected = &case["expected"];
        for (field, value) in [
            ("density", point.density),
            ("speed", point.speed),
            ("throughput", point.throughput),
            ("netGeneration", point.net_change),
        ] {
            assert_eq!(
                value,
                expected[field].as_str().unwrap().parse::<f64>().unwrap(),
                "{} {field}",
                case["name"]
            );
        }
        assert!(
            (point.entropy
                - expected["entropy"]
                    .as_str()
                    .unwrap()
                    .parse::<f64>()
                    .unwrap())
            .abs()
                <= 0.0005
        );
        assert_eq!(
            point.population,
            expected["totalCars"].as_u64().unwrap() as usize
        );
    }
}

#[test]
fn signed_rate_uses_ticks_not_calendar_and_selection_resets_the_baseline() {
    let road = |cells| Calle::new(CalleConfig::new(1, 4, CalleType::Conexion), cells).unwrap();
    let mut streets = vec![road(vec![1, 2, 0, 7]), road(vec![3, 0, 0, 0])];
    let mut metrics = Metrics::new(&streets);
    metrics.update(&streets, Clock::default());
    streets[0] = road(vec![0, 0, 0, 7]);
    metrics.update(&streets, Clock::new(6, 23, 59, 59).unwrap());
    assert_eq!(metrics.history()[1].net_change, -1.);
    metrics.set_included(&streets, vec![false, true]);
    metrics.update(&streets, Clock::default());
    assert_eq!(metrics.history()[2].net_change, 0.);
    streets[1] = road(vec![3, 4, 5, 0]);
    metrics.update(&streets, Clock::default());
    assert_eq!(metrics.history()[3].net_change, 1.);
    assert_eq!(metrics.history()[3].elapsed_seconds, 8);
    // Reapplying the same set must not suppress a real population change.
    metrics.set_included(&streets, vec![false, true]);
    streets[1] = road(vec![0, 0, 0, 0]);
    metrics.update(&streets, Clock::default());
    assert_eq!(metrics.history()[4].net_change, -1.5);
    metrics.reset();
    assert!(metrics.history().is_empty());
    metrics.update(&streets, Clock::default());
    assert_eq!(metrics.history()[0].elapsed_seconds, 2);
    assert_eq!(metrics.history()[0].density, 0.);
}

#[test]
fn status_priority_and_boundaries_match_v1() {
    use ca_core::metrics::Status;
    let point = |density, speed| ca_core::metrics::Point {
        clock: Clock::default(),
        elapsed_seconds: 2,
        population: 0,
        density,
        speed,
        net_change: 0.,
        throughput: 0.,
        entropy: 0.,
    };
    for (density, speed, expected) in [
        (81., 14., Status::Collapse),
        (80., 14., Status::Congested),
        (25., 50., Status::Optimal),
        (60., 50., Status::Optimal),
        (61., 34., Status::Congested),
        (61., 35., Status::Moderate),
        (24., 100., Status::Underused),
        (25., 49., Status::Moderate),
    ] {
        assert_eq!(point(density, speed).status(), expected);
    }
}

#[test]
fn entropy_is_cached_and_complete_history_is_not_limited_to_the_live_window() {
    let road = |cells| Calle::new(CalleConfig::new(1, 4, CalleType::Conexion), cells).unwrap();
    let mut streets = vec![road(vec![1, 0, 0, 0])];
    let mut metrics = Metrics::new(&streets);
    metrics.update(&streets, Clock::default());
    streets[0] = road(vec![0, 0, 0, 0]);
    for _ in 1..=60 {
        metrics.update(&streets, Clock::default());
    }
    assert_eq!(metrics.history()[59].entropy, 0.);
    assert_eq!(metrics.history()[60].entropy, 2.);
    metrics.update(&streets, Clock::default());
    assert_eq!(metrics.history()[61].entropy, 2.);
    assert_eq!(metrics.history().len(), 62);
    assert_eq!(metrics.live().len(), 50);
    assert_eq!(metrics.live()[0].elapsed_seconds, 26);
    // Moving or renaming a street does not change its cells or sampled entropy.
    metrics.reconcile(&streets, None);
    metrics.update(&streets, Clock::default());
    assert_eq!(metrics.history()[62].entropy, 2.);
}
