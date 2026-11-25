use ca_core::map_json::MapDocument;
use ca_core::virtual_time::{Clock, VirtualTime};

#[test]
fn saturday_rolls_over_to_sunday_with_fixed_seconds_per_tick() {
    let mut time = VirtualTime::default();
    time.clock = Clock::new(6, 23, 59, 58).unwrap();
    time.advance();
    assert_eq!(time.clock, Clock::new(0, 0, 0, 0).unwrap());
    assert_eq!(time.clock.export_timestamp(), "Domingo 00:00:00");
    assert_eq!(time.multiplier(), 0.0);
}

#[test]
fn forecast_uses_the_next_day_and_disabled_profiles_have_no_forecast() {
    let mut time = VirtualTime::default();
    time.clock = Clock::new(6, 23, 59, 58).unwrap();
    let mut saturday = time.profiles()[6];
    saturday[23] = 2.0;
    assert!(time.set_profile(6, saturday));
    let next = time.next_change().unwrap();
    assert_eq!(next.clock, Clock::new(0, 0, 0, 0).unwrap());
    assert_eq!(next.seconds_remaining, 2);
    assert_eq!(next.multiplier, 0.0);
    time.enabled = false;
    assert_eq!(time.multiplier(), 1.0);
    assert!(time.next_change().is_none());
}

#[test]
fn map_round_trip_preserves_sunday_zeros_and_older_switch_preference() {
    let mut map = MapDocument::demo();
    let mut time = VirtualTime::default();
    time.clock = Clock::new(0, 0, 0, 0).unwrap();
    time.enabled = false;
    assert!(time.set_profile(0, [0.0; 24]));
    map.set_time(time.clone());
    let saved = map.to_json();
    let restored = MapDocument::parse(&saved).unwrap();
    assert_eq!(restored.time(), &time);
    let mut old: serde_json::Value = serde_json::from_str(&saved).unwrap();
    old["configuracionTiempo"]
        .as_object_mut()
        .unwrap()
        .remove("usarPerfiles");
    let mut restored = MapDocument::parse(&old.to_string()).unwrap();
    restored.inherit_profile_switch(false);
    assert!(!restored.time().enabled);
    assert_eq!(restored.time().clock.parts(), [0, 0, 0, 0]);
}

#[test]
fn zero_profile_blocks_generation_until_profiles_are_disabled() {
    let mut map = MapDocument::parse(
        r#"{"calles":[
        {"nombre":"A","tipo":"generador","tamano":8,"probabilidadGeneracion":1.0}
    ]}"#,
    )
    .unwrap();
    let mut time = VirtualTime::default();
    time.clock = Clock::new(0, 0, 0, 0).unwrap();
    map.set_time(time);
    map.tick();
    assert_eq!(map.model().streets()[0].cells(), &[0; 8]);
    assert_eq!(map.time().clock.parts(), [0, 0, 0, 2]);
    let mut time = map.time().clone();
    time.enabled = false;
    map.set_time(time);
    map.tick();
    assert!(
        map.model().streets()[0]
            .cells()
            .iter()
            .any(|n| (1..=6).contains(n))
    );
}

#[test]
fn v1_time_field_and_legacy_single_day_profiles_are_read_without_losing_zero() {
    let map = MapDocument::parse(
        r#"{"calles":[], "configuracionTiempo": {
        "diaActual": 0, "horaActual": 0, "minutoActual": 0, "segundoActual": 0,
        "usarPerfiles": false,
        "multiplicadoresPorHora": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
    }}"#,
    )
    .unwrap();
    assert_eq!(map.time().clock.parts(), [0, 0, 0, 0]);
    assert!(!map.time().enabled);
    assert_eq!(map.time().profiles(), &[[0.0; 24]; 7]);
    let saved: serde_json::Value = serde_json::from_str(&map.to_json()).unwrap();
    assert_eq!(saved["configuracionTiempo"]["segundosPorPaso"], 2);
    assert_eq!(
        saved["configuracionTiempo"]["multiplicadoresPorDiaHora"]["0"][0],
        0.0
    );
    assert!(saved.get("tiempo").is_none());
}

#[test]
fn invalid_profile_updates_leave_the_valid_profile_unchanged() {
    let mut time = VirtualTime::default();
    assert!(!time.set_profile(0, [f64::NAN; 24]));
    assert!(!time.set_profile(7, [1.0; 24]));
    assert!(!time.set_profile(0, [-0.1; 24]));
    assert!(!time.set_profile(0, [3.1; 24]));
    assert_eq!(time.profiles()[0][0], 0.0);
    assert_eq!(time.profiles()[0][12], 0.6);
}
