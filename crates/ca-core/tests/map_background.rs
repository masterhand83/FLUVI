use ca_core::{map_background::MapBackground, virtual_time::Clock};
use serde_json::json;

#[test]
fn sky_interpolation_keeps_v1_rounding_at_fractional_hours() {
    for ((hour, minute), expected) in [
        ((16, 10), [0x68, 0x9d, 0xec]),
        ((19, 10), [0x0f, 0x1f, 0x5d]),
    ] {
        assert_eq!(
            MapBackground::Sky.rgb(Clock::new(1, hour, minute, 0).unwrap()),
            expected,
        );
    }
}

#[test]
fn v1_custom_background_round_trips_and_old_and_new_maps_use_sky() {
    use ca_core::map_json::MapDocument;
    let mut document = MapDocument::parse(r##"{"calles":[],"personalizacion":{"other":true,"fondoMapa":{"preset":"custom","color":"#39A57C"}}}"##).unwrap();
    assert_eq!(
        document.map_background(),
        MapBackground::Custom([57, 165, 124])
    );
    document.set_map_background(MapBackground::Blue);
    let saved: serde_json::Value = serde_json::from_str(&document.to_json()).unwrap();
    assert_eq!(
        saved["personalizacion"]["fondoMapa"],
        json!({"preset":"blue","color":"#1e3a8a"})
    );
    assert_eq!(saved["personalizacion"]["other"], true);
    assert_eq!(
        MapDocument::parse(&document.to_json())
            .unwrap()
            .map_background(),
        MapBackground::Blue
    );
    assert_eq!(
        MapDocument::parse(r#"{"calles":[]}"#)
            .unwrap()
            .map_background(),
        MapBackground::Sky
    );
    assert_eq!(MapDocument::empty().map_background(), MapBackground::Sky);
    for value in [
        json!({"preset":"unknown"}),
        json!({"preset":"custom","color":"invalid"}),
        json!(null),
    ] {
        assert_eq!(MapBackground::from_json(&value), MapBackground::Sky);
    }
}

#[test]
fn colours_match_v1_at_sample_times() {
    // Captured from v1 DayNightCycle, including interpolation and channel rounding.
    let cases = [
        (
            "sky",
            [
                0x12163a, 0x657cb1, 0xbed5f9, 0x7dacf2, 0x6aa0f0, 0x3759a1, 0x121536,
            ],
        ),
        (
            "blue",
            [
                0x0e1a3e, 0x1a3278, 0x1e3a8a, 0x1e3a8a, 0x1e3a8a, 0x152a63, 0x0d1a3e,
            ],
        ),
        (
            "guinda",
            [
                0x370e1b, 0x6a1b35, 0x7a1f3d, 0x7a1f3d, 0x7a1f3d, 0x57162c, 0x360e1b,
            ],
        ),
        (
            "grey",
            [
                0x595b5c, 0xacb0b2, 0xc6cbcd, 0xc6cbcd, 0xc6cbcd, 0x8e9193, 0x585b5b,
            ],
        ),
        (
            "white",
            [
                0x737373, 0xdddddd, 0xffffff, 0xffffff, 0xffffff, 0xb7b7b7, 0x727272,
            ],
        ),
        (
            "custom",
            [
                0x1a4a38, 0x318f6c, 0x39a57c, 0x39a57c, 0x39a57c, 0x297659, 0x194a37,
            ],
        ),
    ];
    for (preset, expected) in cases {
        let background = MapBackground::from_json(&json!({"preset": preset, "color": "#39a57c"}));
        for ((hour, minute), expected) in [
            (0, 0),
            (5, 30),
            (6, 0),
            (7, 30),
            (12, 0),
            (17, 30),
            (23, 30),
        ]
        .into_iter()
        .zip(expected)
        {
            let rgb = background.rgb(Clock::new(1, hour, minute, 0).unwrap());
            assert_eq!(
                u32::from_be_bytes([0, rgb[0], rgb[1], rgb[2]]),
                expected,
                "{preset} {hour}:{minute}"
            );
        }
    }
}
