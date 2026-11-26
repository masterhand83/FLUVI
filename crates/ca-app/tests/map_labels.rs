use ca_app::labels::street_label;
use ca_core::{
    bezier::{BezierCurve, Section},
    map_json::StreetPlacement,
    streets::RoundaboutDraft,
};

fn street() -> StreetPlacement {
    StreetPlacement {
        bezier: None,
        name: "Sample".into(),
        origin: [10., 20.],
        angle_degrees: 0.,
        curved: false,
        vertices: vec![],
        roundabout: None,
    }
}

#[test]
fn straight_midpoint_includes_half_the_road_width_and_is_upright() {
    let mut road = street();
    let label = street_label(&road, 4, 20);
    assert_eq!(label.position, [20., 22.]);
    assert_eq!(label.angle, 0.);
    road.angle_degrees = 180.;
    let label = street_label(&road, 4, 20);
    assert!((label.position[0] - 0.).abs() < 1e-5);
    assert!((label.position[1] - 18.).abs() < 1e-5);
    assert!(label.angle.abs() < 1e-5);
}

#[test]
fn bezier_midpoint_uses_arc_length_not_the_parameter_or_cell_count() {
    let mut road = street();
    // A collinear quadratic: x(t) = 12t². Half length is x=6, not x(0.5)=3.
    road.bezier = Some(
        BezierCurve::new(
            [0., 0.],
            vec![Section {
                controls: vec![[0., 0.]],
                end: [12., 0.],
            }],
        )
        .unwrap(),
    );
    let label = street_label(&road, 3, 12);
    assert!((label.position[0] - 6.).abs() < 1e-4);
    assert!(label.position[1].abs() < 1e-4);
    assert!(label.angle.abs() < 1e-4);
}

#[test]
fn roundabout_midpoint_is_opposite_the_start_at_the_middle_lane_radius() {
    let mut road = street();
    road.roundabout = Some(RoundaboutDraft {
        center: [20., 30.],
        inner_radius: 5.,
        start_angle: 0.,
    });
    let label = street_label(&road, 2, 36);
    assert!((label.position[0] - 14.).abs() < 1e-4);
    assert!((label.position[1] - 30.).abs() < 1e-4);
    assert!((label.angle.abs() - std::f32::consts::FRAC_PI_2).abs() < 1e-4);
}

#[test]
fn legacy_even_length_curve_midpoint_does_not_depend_on_the_lane_count() {
    use ca_core::geometry::Vertex;
    let mut road = street();
    road.origin = [0.; 2];
    road.curved = true;
    road.vertices = vec![
        Vertex {
            index: 0,
            offset: 0.,
        },
        Vertex {
            index: 1,
            offset: 90.,
        },
    ];
    // End half-segments each measure 0.5. The central segment joins
    // (0.5, 0) to (0, -1.5), so its midpoint is (0.25, -0.75).
    for lanes in [1, 4] {
        let label = street_label(&road, lanes, 2);
        assert!((label.position[0] - 0.25).abs() < 1e-5);
        assert!((label.position[1] + 0.75).abs() < 1e-5);
    }
}

#[test]
fn label_settings_validate_sizes_and_survive_map_replacement_without_serialization() {
    use ca_app::{
        labels::{Labels, Visibility},
        map_session::MapSession,
    };
    use ca_core::map_json::MapDocument;
    let mut labels = Labels::default();
    assert_eq!(labels.visibility, Visibility::Off);
    assert_eq!(labels.font_size(), 14);
    labels.visibility = Visibility::Both;
    labels.set_font_size("21").unwrap();
    for invalid in ["0", "-1", "1.5", "", "NaN", "4294967296"] {
        assert_eq!(labels.set_font_size(invalid), Err("labels.invalidSize"));
        assert_eq!(labels.font_size(), 21);
    }
    use ca_app::shell::{Language, Translator};
    for (language, expected) in [
        (
            Language::Spanish,
            "Introduce un número entero positivo de píxeles.",
        ),
        (
            Language::English,
            "Enter a positive whole number of pixels.",
        ),
    ] {
        assert_eq!(
            Translator::new(language).tr("labels.invalidSize", &[]),
            expected
        );
    }
    let mut session = MapSession::new(MapDocument::empty());
    labels.sync(session.document(), session.revision(), [0.; 2]);
    session.replace(
        true,
        MapDocument::parse(r#"{"calles":[{"nombre":"Loaded","tipo":"conexion","tamano":20}]}"#)
            .unwrap(),
        &mut (),
    );
    labels.invalidate_geometry();
    labels.sync(session.document(), session.revision(), [0.; 2]);
    assert_eq!(labels.visibility, Visibility::Both);
    assert_eq!(labels.font_size(), 21);
    let saved = session.document().to_json();
    assert!(!saved.contains("labels"));
    assert!(!saved.contains("fontSize"));
    session.replace(true, MapDocument::empty(), &mut ());
    labels.invalidate_geometry();
    labels.sync(session.document(), session.revision(), [0.; 2]);
    assert_eq!(labels.visibility, Visibility::Both);
    assert_eq!(labels.font_size(), 21);
}

#[test]
fn label_text_tracks_the_camera_without_scaling_the_font() {
    use ca_app::labels::{Labels, Visibility};
    use ca_core::{camera::WorldView, map_json::MapDocument};
    use eframe::egui;
    let document = MapDocument::parse(
        r#"{"calles":[{"nombre":"Road","tipo":"generador","tamano":20,"carriles":2,"x":50,"y":100}]}"#,
    ).unwrap();
    let mut labels = Labels::default();
    labels.visibility = Visibility::Streets;
    labels.sync(&document, 0, [0.; 2]);
    let ctx = egui::Context::default();
    let rect = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(800., 400.));
    for (view, expected_center) in [
        (
            WorldView {
                origin: [0., 0.],
                span: [100., 50.],
            },
            egui::pos2(160., 168.),
        ),
        (
            WorldView {
                origin: [10., 11.],
                span: [50., 25.],
            },
            egui::pos2(160., 160.),
        ),
    ] {
        let output = ctx.run(egui::RawInput::default(), |ctx| {
            let painter = ctx.layer_painter(egui::LayerId::background());
            labels.paint(&painter, view, rect);
        });
        let text = output
            .shapes
            .iter()
            .find_map(|s| match &s.shape {
                egui::Shape::Text(text) if text.override_text_color.is_none() => Some(text),
                _ => None,
            })
            .unwrap();
        assert_eq!(text.galley.job.text, "Road");
        assert_eq!(text.galley.job.sections[0].format.font_id.size, 14.);
        assert!((text.pos + text.galley.size() / 2.).distance(expected_center) < 1e-4);
    }
    labels.set_font_size("500").unwrap();
    let output = ctx.run(egui::RawInput::default(), |ctx| {
        labels.paint(
            &ctx.layer_painter(egui::LayerId::background()),
            WorldView {
                origin: [0.; 2],
                span: [100., 50.],
            },
            rect,
        );
    });
    assert!(output.shapes.iter().any(|s| match &s.shape {
        egui::Shape::Text(text) => text.galley.job.sections[0].format.font_id.size == 500.,
        _ => false,
    }));
}
