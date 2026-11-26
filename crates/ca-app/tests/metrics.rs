use ca_app::metrics::{Delivery, Metric, MetricsPanel, Packet};
use ca_core::{map_json::MapDocument, metrics::Metrics, virtual_time::Clock};
use crossbeam_channel::bounded;

fn chart_frame(
    ctx: &eframe::egui::Context,
    panel: &mut MetricsPanel,
    pointer: Option<eframe::egui::Pos2>,
) -> eframe::egui::FullOutput {
    use eframe::egui;
    ctx.run(
        egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(300., 1800.),
            )),
            events: pointer.map(egui::Event::PointerMoved).into_iter().collect(),
            ..Default::default()
        },
        |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                panel.show(ui, &ca_app::shell::Shell::load(None));
            });
        },
    )
}

fn chart_points() -> MetricsPanel {
    let mut panel = MetricsPanel::default();
    for (second, density) in [(2, 10.), (4, 40.)] {
        panel.receive(Packet::Point(ca_core::metrics::Point {
            clock: Clock::new(1, 7, 0, second).unwrap(),
            elapsed_seconds: u64::from(second),
            density,
            net_change: -0.5,
            speed: 60.,
            throughput: 2.4,
            entropy: 1.25,
            population: 4,
        }));
    }
    panel
}

#[test]
fn charts_show_titles_latest_values_labelled_axes_and_five_line_colours() {
    use eframe::egui;
    let ctx = egui::Context::default();
    let output = chart_frame(&ctx, &mut chart_points(), None);
    let labels: Vec<_> = output
        .shapes
        .iter()
        .filter_map(|shape| match &shape.shape {
            egui::Shape::Text(text) => Some(text.galley.job.text.as_str()),
            _ => None,
        })
        .collect();
    for label in [
        "Densidad",
        "Velocidad estimada",
        "Flujo vehicular estimado",
        "Tasa de cambio neto de población",
        "Entropía de Shannon de transiciones",
        "Actual: 40.00%",
        "Actual: -0.50 veh/s",
        "Actual: 1.250 bits",
        "07:00:02",
        "07:00:04",
    ] {
        assert!(labels.contains(&label), "missing chart label: {label}");
    }
    assert_eq!(
        labels.iter().filter(|&&s| s == "Tiempo simulado").count(),
        5
    );
    let colours: std::collections::HashSet<_> = output
        .shapes
        .iter()
        .filter_map(|s| {
            if let egui::Shape::Path(path) = &s.shape
                && let egui::epaint::ColorMode::Solid(colour) = path.stroke.color
            {
                Some(colour)
            } else {
                None
            }
        })
        .collect();
    assert_eq!(colours.len(), 5, "each metric needs its own line colour");
}

fn scaled_chart_output(values: &[f64]) -> eframe::egui::FullOutput {
    let mut panel = MetricsPanel::default();
    for (index, &value) in values.iter().enumerate() {
        panel.receive(Packet::Point(ca_core::metrics::Point {
            clock: Clock::default(),
            elapsed_seconds: index as u64 * 2,
            density: value,
            net_change: value,
            speed: value,
            throughput: value,
            entropy: value,
            population: 0,
        }));
    }
    chart_frame(&eframe::egui::Context::default(), &mut panel, None)
}

fn plotted_lines(
    output: &eframe::egui::FullOutput,
) -> Vec<(eframe::egui::Rect, Vec<eframe::egui::Pos2>)> {
    use eframe::egui;
    let mut plot = None;
    let mut lines = Vec::new();
    for shape in &output.shapes {
        match &shape.shape {
            egui::Shape::Rect(rect) => plot = Some(rect.rect),
            egui::Shape::Path(path) => {
                lines.push((plot.expect("plot background"), path.points.clone()))
            }
            _ => {}
        }
    }
    lines
}

#[test]
fn nonzero_chart_extrema_have_padding_and_zero_stays_on_the_baseline() {
    for values in [vec![0., 100.], vec![-3., 3.], vec![0., 0.], vec![2.4, 2.4]] {
        let output = scaled_chart_output(&values);
        let lines = plotted_lines(&output);
        assert_eq!(lines.len(), 5);
        for (plot, line) in lines {
            for (point, value) in line.into_iter().zip(&values) {
                if *value == 0. {
                    assert!((point.y - plot.bottom()).abs() < 0.1);
                    continue;
                }
                assert!(
                    point.y > plot.top() + 4. && point.y < plot.bottom() - 4.,
                    "sample must have room for the hover marker: {point:?} in {plot:?}"
                );
            }
        }
    }
}

#[test]
fn charts_rescale_small_values_and_forget_extrema_outside_the_live_window() {
    for values in [vec![0., 0.01, 0.02], {
        let mut values = vec![100.];
        values.extend((0..50).map(|i| if i % 2 == 0 { 0.01 } else { 0.02 }));
        values
    }] {
        let output = scaled_chart_output(&values);
        for (plot, line) in plotted_lines(&output) {
            let top = line.iter().map(|p| p.y).fold(f32::INFINITY, f32::min);
            let bottom = line.iter().map(|p| p.y).fold(f32::NEG_INFINITY, f32::max);
            assert!(
                bottom - top > plot.height() / 3.,
                "small changes must remain visible"
            );
            assert!(
                line.iter()
                    .all(|p| p.y > plot.top() && p.y <= plot.bottom())
            );
        }
    }
    let output = scaled_chart_output(&[0.01, 0.01]);
    let labels: Vec<_> = output
        .shapes
        .iter()
        .filter_map(|s| match &s.shape {
            eframe::egui::Shape::Text(t) => Some(t.galley.job.text.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        labels.contains(&"0.0"),
        "zero must remain visible on the axis"
    );
    assert!(labels.contains(&"0.011"));
}

#[test]
fn zero_reference_is_labelled_and_negative_values_extend_below_it() {
    use eframe::egui;
    for values in [vec![0.01, 0.02], vec![-0.01, -0.02], vec![-0.01, 0.04]] {
        let output = scaled_chart_output(&values);
        for (plot, line) in plotted_lines(&output) {
            let zero = output
                .shapes
                .iter()
                .find_map(|shape| match &shape.shape {
                    egui::Shape::LineSegment { points, stroke }
                        if stroke.width == 1.5
                            && (points[0].x - plot.left()).abs() < 0.1
                            && (points[1].x - plot.right()).abs() < 0.1
                            && (plot.top()..=plot.bottom()).contains(&points[0].y) =>
                    {
                        Some(points[0].y)
                    }
                    _ => None,
                })
                .expect("visible zero reference");
            for (point, value) in line.iter().zip(&values) {
                assert!(if *value < 0. {
                    point.y > zero
                } else {
                    point.y < zero
                });
            }
            if values.iter().all(|&v| v > 0.) {
                assert!((zero - plot.bottom()).abs() < 0.1);
            } else if values.iter().all(|&v| v < 0.) {
                assert!((zero - plot.top()).abs() < 0.1);
            }
            assert!(output.shapes.iter().any(|shape| matches!(&shape.shape, egui::Shape::Text(text)
                if text.galley.job.text == "0.0" && (text.pos.y + text.galley.size().y * 0.5 - zero).abs() < 1.)));
        }
    }
}

#[test]
fn graph_hover_immediately_shows_sample_value_time_and_marker() {
    use eframe::egui;
    let ctx = egui::Context::default();
    let mut panel = chart_points();
    chart_frame(&ctx, &mut panel, None);
    let output = chart_frame(&ctx, &mut panel, None);
    let path = output
        .shapes
        .iter()
        .find_map(|shape| match &shape.shape {
            egui::Shape::Path(path) if path.points.len() == 2 => Some(path),
            _ => None,
        })
        .expect("density line");
    let point = path.points[0];
    let output = chart_frame(&ctx, &mut panel, Some(point));
    assert!(
        output
            .shapes
            .iter()
            .any(|shape| matches!(&shape.shape, egui::Shape::Text(text)
        if text.galley.job.text == "07:00:02 · 10.00%"))
    );
    assert!(
        output
            .shapes
            .iter()
            .any(|shape| matches!(&shape.shape, egui::Shape::Circle(circle)
        if circle.center.distance(point) < 0.1 && circle.radius >= 4.))
    );
    // Hover also works with a single point and with no history after a reset.
    panel.receive(Packet::Reset);
    let _ = chart_frame(&ctx, &mut panel, Some(point));
    panel.receive(Packet::Point(ca_core::metrics::Point {
        clock: Clock::default(),
        elapsed_seconds: 2,
        density: 0.,
        net_change: 0.,
        speed: 0.,
        throughput: 0.,
        entropy: 0.,
        population: 0,
    }));
    let _ = chart_frame(&ctx, &mut panel, Some(point));
}

#[test]
fn full_or_closed_chart_channel_never_blocks_or_loses_export_history() {
    let document = MapDocument::demo();
    let mut metrics = Metrics::new(document.model().streets());
    for _ in 0..65 {
        metrics.update(document.model().streets(), Clock::default());
    }
    let (tx, rx) = bounded(1);
    let mut delivery = Delivery::default();
    let mut panel = MetricsPanel::default();
    for _ in 0..70 {
        delivery.publish(&metrics, &tx);
        for packet in rx.try_iter() {
            panel.receive(packet);
        }
    }
    assert_eq!(panel.history().len(), 65);
    assert_eq!(panel.live().len(), 50);
    assert_eq!(panel.live()[0].elapsed_seconds, 32);
    assert_eq!(metrics.history().len(), 65);
    metrics.reset();
    delivery.reset();
    delivery.publish(&metrics, &tx);
    assert!(matches!(rx.try_recv(), Ok(Packet::Reset)));
    drop(rx);
    delivery.publish(&metrics, &tx);
}

#[test]
fn tooltip_contains_only_name_timestamp_value_and_short_status_in_both_languages() {
    let document = MapDocument::demo();
    let mut metrics = Metrics::new(document.model().streets());
    metrics.update(document.model().streets(), Clock::default());
    let shell = ca_app::shell::Shell::load(None);
    for language in [
        ca_app::shell::Language::Spanish,
        ca_app::shell::Language::English,
    ] {
        let translator = ca_app::shell::Translator::new(language);
        let lines = Metric::Density.tooltip(metrics.history()[0], &translator);
        assert_eq!(lines.len(), 4);
        assert!(lines[1].contains("07:00:00"));
        assert!(!lines.iter().any(|line| line.starts_with("metrics.")));
        // Labels are supplied by the active translator, not recorded in history.
        assert_eq!(lines[0], translator.tr("metrics.density", &[]));
    }
    // Keep shell use representative of the UI boundary.
    let ctx = eframe::egui::Context::default();
    let _ = ctx.run(Default::default(), |ctx| {
        eframe::egui::CentralPanel::default().show(ctx, |ui| {
            let mut panel = MetricsPanel::default();
            panel.show(ui, &shell);
        });
    });
}

#[test]
fn checklist_is_alphabetical_and_surviving_selection_follows_street_deletion() {
    let mut doc = MapDocument::demo();
    doc.edit_streets(ca_core::streets::StreetEdit::Update(
        0,
        ca_core::streets::StreetChange::Name("Zulu".into()),
    ))
    .unwrap();
    doc.edit_streets(ca_core::streets::StreetEdit::Update(
        1,
        ca_core::streets::StreetChange::Name("Alfa".into()),
    ))
    .unwrap();
    let mut panel = MetricsPanel::default();
    panel.configure(&doc, None);
    let rows = panel.rows();
    assert_eq!(rows[0], 1);
    panel.accept_selection(vec![true, false, true]);
    assert!(doc.delete_street(0));
    panel.configure(&doc, Some(0));
    assert_eq!(panel.included(), &[false, true]);
}

#[test]
fn checklist_applies_only_after_confirmation_and_cancel_keeps_selection() {
    use eframe::egui;
    let ctx = egui::Context::default();
    let doc = MapDocument::demo();
    let shell = ca_app::shell::Shell::load(None);
    let mut panel = MetricsPanel::default();
    panel.configure(&doc, None);
    panel.open_checklist();
    let mut selected = None;
    let mut frame = |panel: &mut MetricsPanel, events| {
        ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(1200., 900.),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                if let Some(value) = panel.dialog(ctx, &doc, &shell) {
                    selected = Some(value);
                }
            },
        )
    };
    frame(&mut panel, vec![]);
    let output = frame(&mut panel, vec![]);
    let position = |label: &str| {
        output
            .shapes
            .iter()
            .find_map(|shape| {
                if let egui::Shape::Text(text) = &shape.shape
                    && text.galley.job.text == label
                {
                    Some(text.visual_bounding_rect().center())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| panic!("missing {label}"))
    };
    for label in ["Ninguna", "Aplicar"] {
        let pos = position(label);
        for pressed in [true, false] {
            frame(
                &mut panel,
                vec![
                    egui::Event::PointerMoved(pos),
                    egui::Event::PointerButton {
                        pos,
                        pressed,
                        button: egui::PointerButton::Primary,
                        modifiers: egui::Modifiers::NONE,
                    },
                ],
            );
        }
        assert_eq!(
            panel.included(),
            &[true; 3],
            "draft must not alter live metrics"
        );
    }
    panel.accept_selection(selected.take().unwrap());
    assert_eq!(panel.included(), &[false; 3]);
    panel.open_checklist();
    let _ = ctx.run(
        egui::RawInput {
            events: vec![egui::Event::Key {
                key: egui::Key::Escape,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: egui::Modifiers::NONE,
            }],
            ..Default::default()
        },
        |ctx| {
            assert!(panel.dialog(ctx, &doc, &shell).is_none());
        },
    );
    assert_eq!(panel.included(), &[false; 3]);
}

#[test]
fn map_overlay_distinguishes_included_and_excluded_roads_and_hides_outside_pick_mode() {
    use ca_core::camera::WorldView;
    use eframe::egui;
    let document = MapDocument::parse(
        r#"{"calles":[
          {"nombre":"A","tipo":"conexion","tamano":3,"x":25,"y":25},
          {"nombre":"B","tipo":"conexion","tamano":3,"x":25,"y":50}
        ]}"#,
    )
    .unwrap();
    let mut panel = MetricsPanel::default();
    panel.configure(&document, None);
    panel.accept_selection(vec![true, false]);
    let ctx = egui::Context::default();
    let draw = |panel: &MetricsPanel| {
        ctx.run(Default::default(), |ctx| {
            let painter = ctx.layer_painter(egui::LayerId::background());
            panel.paint(
                &painter,
                WorldView {
                    origin: [0.; 2],
                    span: [20.; 2],
                },
                egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(400., 400.)),
                [0.; 2],
            );
        })
    };
    assert!(draw(&panel).shapes.is_empty());
    panel.picking = true;
    let shapes = draw(&panel).shapes;
    assert!(
        shapes
            .iter()
            .any(|s| matches!(&s.shape, egui::Shape::Path(p)
        if p.stroke.color == egui::epaint::ColorMode::Solid(egui::Color32::LIGHT_GREEN)))
    );
    assert!(shapes.iter().any(
        |s| matches!(&s.shape, egui::Shape::LineSegment { stroke, .. }
        if stroke.color == egui::Color32::LIGHT_RED)
    ));
}
