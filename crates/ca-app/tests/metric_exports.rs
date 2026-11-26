use ca_app::metric_exports::{Context, build_csv, build_json, standalone_json};
use ca_core::{
    metrics::Point,
    virtual_time::{Clock, VirtualTime},
};

#[test]
fn export_progress_stays_incomplete_when_the_snapshot_is_cancelled() {
    use ca_app::{
        capture::SaveResult,
        job_progress::Stage,
        metric_exports::{ImageOptions, Kind, start_save},
    };
    let (snapshot, job) = start_save(
        Kind::Csv,
        ImageOptions::default(),
        "test".into(),
        egui::Context::default(),
    )
    .unwrap();
    let before = job.progress.snapshot();
    assert_eq!(before.percent, 0);
    assert_eq!(before.stage, Stage::Waiting);
    // This ends the request before any native save dialog or file write.
    drop(snapshot);
    let result = job
        .result
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    assert!(matches!(result, SaveResult::Failed(_)));
    assert_eq!(
        job.progress.snapshot().percent,
        0,
        "cancelled work must not claim completion"
    );
}

fn history() -> Vec<Point> {
    let data: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/metric-exports/input.json")).unwrap();
    data.as_array()
        .unwrap()
        .iter()
        .map(|p| {
            let second = p["second"].as_u64().unwrap();
            Point {
                clock: Clock::new(3, 23, 58 + (second / 60) as u8, (second % 60) as u8).unwrap(),
                elapsed_seconds: second + 2,
                density: p["density"].as_f64().unwrap(),
                throughput: p["throughput"].as_f64().unwrap(),
                net_change: p["netGeneration"].as_f64().unwrap(),
                speed: p["speed"].as_f64().unwrap(),
                entropy: p["entropy"].as_f64().unwrap(),
                population: 0,
            }
        })
        .collect()
}

fn context() -> Context {
    let mut time = VirtualTime::default();
    time.clock = Clock::new(3, 23, 59, 48).unwrap();
    Context {
        time,
        export_date: "2026-11-26T12:34:56.789Z".into(),
    }
}

#[test]
fn exports_match_the_v1_builders_for_full_history_and_latest_fifty() {
    let history = history();
    let context = context();
    let csv = build_csv(&history, &context);
    assert_eq!(csv.content, include_str!("fixtures/metric-exports/all.csv"));
    assert_eq!(csv.file_name, "metricas_trafico_Miércoles_23h59m.csv");
    assert_eq!(csv.count, 55);
    let json = standalone_json(&history, &context);
    assert_eq!(
        json.content,
        include_str!("fixtures/metric-exports/live.json")
    );
    assert_eq!(json.file_name, "metricas_trafico_Miércoles_23h59m.json");
    assert_eq!(json.count, 50);
    let complete = build_json(&history, &context);
    assert_eq!(
        complete.content,
        include_str!("fixtures/metric-exports/all.json")
    );
    assert_eq!(complete.count, 55);
}

#[test]
fn empty_exports_keep_the_legacy_numeric_zero_statistics() {
    let context = context();
    assert_eq!(
        build_csv(&[], &context).content,
        include_str!("fixtures/metric-exports/empty-all.csv")
    );
    assert_eq!(
        build_json(&[], &context).content,
        include_str!("fixtures/metric-exports/empty-all.json")
    );
    assert_eq!(
        standalone_json(&[], &context).content,
        include_str!("fixtures/metric-exports/empty-live.json")
    );
}

fn archive_files(bytes: Vec<u8>) -> std::collections::BTreeMap<String, Vec<u8>> {
    use std::io::Read;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    assert_eq!(zip.len(), 7);
    (0..zip.len())
        .map(|i| {
            let mut file = zip.by_index(i).unwrap();
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).unwrap();
            (file.name().to_owned(), bytes)
        })
        .collect()
}

#[test]
fn image_archive_has_the_seven_legacy_names_and_printable_full_history_images() {
    use ca_app::{
        metric_exports::build_image_zip,
        metrics::{MetricsPanel, Packet},
    };
    let history = history();
    let mut panel = MetricsPanel::default();
    for &point in &history {
        panel.receive(Packet::Point(point));
    }
    let before = panel.history().to_vec();
    let document = ca_core::map_json::MapDocument::demo();
    let files = archive_files(build_image_zip(panel.history(), &document, 1).unwrap());
    assert_eq!(
        files.keys().map(String::as_str).collect::<Vec<_>>(),
        [
            "densidad.png",
            "entropia.png",
            "flujo_vehicular.png",
            "mapa_de_calor.png",
            "resumen.png",
            "tasa_de_cambio.png",
            "velocidad.png"
        ]
    );
    for (name, bytes) in &files {
        let image = image::load_from_memory(bytes).unwrap().to_rgba8();
        assert_eq!(image.width(), 1600, "{name}");
        assert_eq!(image.get_pixel(0, 0).0, [255, 255, 255, 255], "{name}");
        assert!(image.pixels().all(|p| p[3] == 255), "{name}");
        assert!(
            image.pixels().any(|p| p.0[0..3] != [255, 255, 255]),
            "{name}"
        );
    }
    let live_files = archive_files(build_image_zip(panel.live(), &document, 1).unwrap());
    // The first sample is a large density spike absent from the latest-50 window.
    assert_ne!(files["densidad.png"], live_files["densidad.png"]);
    assert_eq!(panel.history(), before);
    assert_eq!(panel.live().len(), 50);
}

#[test]
fn heatmap_is_fresh_even_with_no_selected_metric_roads_or_open_dialog() {
    use ca_app::metric_exports::build_image_zip;
    let mut scene = ca_gpu::TrafficScene::from_document(&ca_core::map_json::MapDocument::demo());
    scene.set_metric_streets(vec![false; scene.document().layout().len()]);
    let old_dialog_frame = scene.heatmap_snapshot().unwrap();
    let history = history();
    let before = archive_files(build_image_zip(&history, scene.document(), 0).unwrap());
    assert!(scene.toggle_vehicle(
        ca_core::cell_index::CellRef {
            street: 0,
            lane: 0,
            index: 5
        },
        true
    ));
    assert_eq!(
        old_dialog_frame.tiles[5].density,
        Some(0.2),
        "the retained dialog frame is stale"
    );
    let after = archive_files(build_image_zip(&history, scene.document(), 0).unwrap());
    assert_ne!(before["mapa_de_calor.png"], after["mapa_de_calor.png"]);
    for name in [
        "densidad.png",
        "flujo_vehicular.png",
        "velocidad.png",
        "tasa_de_cambio.png",
        "entropia.png",
    ] {
        assert_eq!(
            before[name], after[name],
            "{name} must only depend on metric history"
        );
    }
}

#[test]
fn image_language_and_quality_change_reports_but_keep_names_and_text_exports_stable() {
    use ca_app::{
        graphics::ExportQuality,
        metric_exports::{ImageOptions, build_image_zip_with_options},
        shell::Language,
    };
    let history = history();
    let document = ca_core::map_json::MapDocument::demo();
    let options = ImageOptions {
        language: Language::English,
        quality: ExportQuality::Performance,
    };
    let english =
        archive_files(build_image_zip_with_options(&history, &document, 1, options).unwrap());
    let spanish = archive_files(
        build_image_zip_with_options(
            &history,
            &document,
            1,
            ImageOptions {
                language: Language::Spanish,
                ..options
            },
        )
        .unwrap(),
    );
    assert_eq!(
        english.keys().collect::<Vec<_>>(),
        spanish.keys().collect::<Vec<_>>()
    );
    for name in english.keys() {
        assert_ne!(
            english[name], spanish[name],
            "{name} must use the selected language"
        );
    }
    for (quality, width) in [
        (ExportQuality::Balance, 1600),
        (ExportQuality::Quality, 2400),
        (ExportQuality::Ultraquality, 3200),
    ] {
        let files = archive_files(
            build_image_zip_with_options(
                &history,
                &document,
                1,
                ImageOptions { quality, ..options },
            )
            .unwrap(),
        );
        for bytes in files.values() {
            let image = image::load_from_memory(bytes).unwrap();
            assert_eq!(image.width(), width);
        }
        assert_ne!(files["densidad.png"], english["densidad.png"]);
    }
    assert_eq!(
        build_csv(&history, &context()).content,
        include_str!("fixtures/metric-exports/all.csv")
    );
    assert_eq!(
        standalone_json(&history, &context()).content,
        include_str!("fixtures/metric-exports/live.json")
    );
}

#[test]
fn exported_charts_have_thin_traces_and_six_time_ticks() {
    use ca_app::{
        graphics::ExportQuality,
        metric_exports::{ImageOptions, build_image_zip_with_options},
        shell::Language,
    };
    let points: Vec<_> = history()
        .into_iter()
        .take(6)
        .map(|mut p| {
            p.density = 20.;
            p
        })
        .collect();
    let files = archive_files(
        build_image_zip_with_options(
            &points,
            &ca_core::map_json::MapDocument::demo(),
            1,
            ImageOptions {
                language: Language::English,
                quality: ExportQuality::Performance,
            },
        )
        .unwrap(),
    );
    let image = image::load_from_memory(&files["densidad.png"])
        .unwrap()
        .to_rgb8();
    // Six evenly spaced time positions over this six-sample chart, with visible tick marks.
    for x in [440, 700, 960, 1220] {
        assert!(
            image.get_pixel(x, 625).0.iter().all(|v| *v < 240),
            "time tick at {x}"
        );
    }
    let colored = (170..200)
        .filter(|y| {
            let p = image.get_pixel(800, *y);
            i16::from(p[2]) - i16::from(p[0]) > 80
        })
        .count();
    assert!(
        (1..=2).contains(&colored),
        "thin density trace covers {colored} pixels"
    );
}
