use ca_core::{
    heatmap::local_density,
    traffic::{Calle, CalleConfig, CalleType},
};

#[test]
fn roundabouts_wrap_without_counting_small_rings_twice() {
    for (cells, expected) in [
        (vec![1], 1.),
        (vec![1, 7], 0.5),
        (vec![1, 7, 0], 1. / 3.),
        (vec![1, 0, 7, 2], 0.5),
        (vec![1, 0, 0, 0, 2, 6], 3. / 5.),
    ] {
        let mut config = CalleConfig::new(1, cells.len(), CalleType::Conexion);
        config.periodic = true;
        let street = Calle::new(config, cells).unwrap();
        assert_eq!(local_density(&street, 0, 0), Some(expected));
    }
}

#[test]
fn centered_windows_clip_at_ends_and_stay_in_the_same_lane() {
    let street = Calle::new(
        CalleConfig::new(2, 6, CalleType::Conexion),
        vec![1, 7, 2, 0, 0, 6, 1, 1, 1, 1, 1, 1],
    )
    .unwrap();
    // First window [1, obstacle, 2]; final window [0, 0, 6].
    assert_eq!(local_density(&street, 0, 0), Some(2. / 3.));
    assert_eq!(local_density(&street, 0, 2), Some(2. / 5.));
    assert_eq!(local_density(&street, 0, 5), Some(1. / 3.));
    assert_eq!(local_density(&street, 1, 0), Some(1.));
    assert_eq!(local_density(&street, 0, 1), None);
    assert_eq!(local_density(&street, 0, 3), None);
    assert_eq!(local_density(&street, 2, 0), None);
    assert_eq!(local_density(&street, 0, 6), None);
}
