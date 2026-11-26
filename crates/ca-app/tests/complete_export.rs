use ca_app::{
    graphics::ExportQuality,
    metric_exports::{CompleteExport, Context, ImageOptions, Snapshot},
    shell::Language,
};
use ca_core::{map_json::MapDocument, metrics::Point, virtual_time::Clock};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
};

fn files(bytes: Vec<u8>) -> BTreeMap<String, Vec<u8>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
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
fn complete_zip_matches_v1_names_and_uses_all_samples() {
    let document = MapDocument::demo();
    let snapshot = Snapshot {
        history: (1..=55)
            .map(|second| Point {
                clock: Clock::new(1, 7, 0, second).unwrap(),
                elapsed_seconds: second as u64 * 2,
                density: 25.,
                throughput: 1.5,
                speed: 60.,
                net_change: 0.5,
                entropy: 1.25,
                population: 4,
            })
            .collect(),
        document,
        included: 3,
        viewport: None,
    };
    let context = Context {
        time: snapshot.document.time().clone(),
        export_date: "2026-11-26T12:34:56.789Z".into(),
    };
    let viewport = ca_app::capture::encode_png(&ca_gpu::CapturedImage {
        pixels: [2, 1],
        rgba: vec![20, 40, 60, 255, 80, 100, 120, 255],
    })
    .unwrap();
    let prepared = CompleteExport::prepare(
        &snapshot,
        &context,
        &viewport,
        ImageOptions {
            language: Language::English,
            quality: ExportQuality::Performance,
        },
    )
    .unwrap();
    let export = prepared.finish().unwrap();
    assert!(export.analysis_error.is_none());
    let files = files(export.bytes);
    assert_eq!(
        files.keys().map(String::as_str).collect::<Vec<_>>(),
        [
            "analisis_metricas.json",
            "analisis_temporal.png",
            "diagrama_fundamental.png",
            "distribuciones_correlaciones.png",
            "graficas/densidad.png",
            "graficas/entropia.png",
            "graficas/flujo_vehicular.png",
            "graficas/tasa_de_cambio.png",
            "graficas/velocidad.png",
            "mapa_actual.png",
            "mapa_de_calor.png",
            "metricas.csv",
            "metricas.json",
            "resumen.png",
        ]
    );
    let json: serde_json::Value = serde_json::from_slice(&files["metricas.json"]).unwrap();
    assert_eq!(json["metadata"]["totalDataPoints"], 55);
    assert_eq!(json["metrics"]["density"].as_array().unwrap().len(), 55);
    assert!(String::from_utf8_lossy(&files["metricas.csv"]).contains("Total de Mediciones: 55"));
    assert_eq!(files["mapa_actual.png"], viewport);
    let report: serde_json::Value =
        serde_json::from_slice(&files["analisis_metricas.json"]).unwrap();
    assert_eq!(report["language"], "en");
    assert_eq!(report["generatedAt"], "2026-11-26T12:34:56.789Z");
    assert!(report["analysis"].is_object());
    for (name, bytes) in &files {
        if name.ends_with(".png") {
            image::load_from_memory(bytes).unwrap();
        }
    }
}

#[test]
fn complete_export_button_emits_one_action_and_is_disabled_during_export() {
    use ca_app::{
        metric_exports::Kind,
        metrics::{Action, MetricsPanel, Packet},
    };
    use egui::{Event, PointerButton, Pos2, Rect, Vec2};
    let ctx = egui::Context::default();
    let mut panel = MetricsPanel::default();
    panel.receive(Packet::Point(Point {
        clock: Clock::default(),
        elapsed_seconds: 2,
        density: 25.,
        throughput: 1.5,
        speed: 60.,
        net_change: 0.5,
        entropy: 1.25,
        population: 4,
    }));
    let shell = ca_app::shell::Shell::load(None);
    let frame = |panel: &mut MetricsPanel, events| {
        let mut action = None;
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(600., 1800.))),
                events,
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default().show(ctx, |ui| {
                    action = panel.show(ui, &shell);
                });
            },
        );
        (output, action)
    };
    frame(&mut panel, vec![]);
    let (output, _) = frame(&mut panel, vec![]);
    let pos = output
        .shapes
        .iter()
        .find_map(|s| match &s.shape {
            egui::Shape::Text(t) if t.galley.text() == "Exportación completa (ZIP)" => {
                Some(t.pos + t.galley.size() * 0.5)
            }
            _ => None,
        })
        .expect("Complete Export button");
    let click = |pressed| {
        vec![
            Event::PointerMoved(pos),
            Event::PointerButton {
                pos,
                button: PointerButton::Primary,
                pressed,
                modifiers: egui::Modifiers::NONE,
            },
        ]
    };
    frame(&mut panel, click(true));
    assert!(matches!(
        frame(&mut panel, click(false)).1,
        Some(Action::Export(Kind::Complete))
    ));
    panel.exporting = true;
    frame(&mut panel, click(true));
    assert!(frame(&mut panel, click(false)).1.is_none());
}

#[test]
fn analyzer_failure_keeps_base_files_and_gives_a_translated_warning() {
    use ca_app::{
        metric_exports::{SaveResult, save_file},
        shell::{Severity, Translator},
    };
    let snapshot = Snapshot {
        document: MapDocument::demo(),
        history: vec![Point {
            clock: Clock::default(),
            elapsed_seconds: 2,
            density: 25.,
            throughput: 1.5,
            speed: 60.,
            net_change: 0.5,
            entropy: 1.25,
            population: 4,
        }],
        included: 3,
        viewport: None,
    };
    let context = Context {
        time: snapshot.document.time().clone(),
        export_date: "2026-11-26T12:34:56.789Z".into(),
    };
    let prepared = CompleteExport::prepare(
        &snapshot,
        &context,
        b"frozen viewport",
        ImageOptions {
            quality: ExportQuality::Performance,
            ..Default::default()
        },
    )
    .unwrap();
    let archive = prepared
        .finish_with(|csv, language| {
            assert!(csv.contains("Total de Mediciones: 1"));
            assert_eq!(language, Language::Spanish);
            Err("forced analyzer failure".into())
        })
        .unwrap();
    let path =
        std::env::temp_dir().join(format!("fluvi-complete-export-{}.zip", std::process::id()));
    let result = save_file(&path, &archive.bytes, archive.analysis_error.clone());
    let saved = std::fs::read(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    let files = files(saved);
    assert_eq!(files.len(), 11);
    assert_eq!(
        files["analisis_python_error.txt"],
        b"forced analyzer failure"
    );
    assert_eq!(files["mapa_actual.png"], b"frozen viewport");
    for name in [
        "metricas.csv",
        "metricas.json",
        "resumen.png",
        "mapa_de_calor.png",
        "graficas/densidad.png",
        "graficas/flujo_vehicular.png",
        "graficas/velocidad.png",
        "graficas/tasa_de_cambio.png",
        "graficas/entropia.png",
    ] {
        assert!(files.contains_key(name), "{name}");
    }
    assert!(
        matches!(&result, SaveResult::SavedWithoutAnalysis(error) if error == "forced analyzer failure")
    );
    let (severity, key) = result.notice();
    assert!(matches!(severity, Severity::Warning));
    assert_eq!(
        Translator::new(Language::English).tr(key, &[]),
        "ZIP saved without analysis. See analisis_python_error.txt."
    );
    assert_eq!(
        Translator::new(Language::Spanish).tr(key, &[]),
        "ZIP guardado sin análisis. Consulta analisis_python_error.txt."
    );
    let failed = save_file(
        std::path::Path::new(""),
        &archive.bytes,
        archive.analysis_error,
    );
    assert!(matches!(failed, SaveResult::Failed(_)));
    assert!(matches!(failed.notice().0, Severity::Error));
}

#[test]
fn complete_export_and_whole_map_capture_share_one_job_limit_in_both_start_orders() {
    use ca_app::{
        capture,
        metric_exports::{Kind, start_save},
    };
    use std::time::Duration;
    let ctx = egui::Context::default();
    let map = capture::start_save("test".into(), ctx.clone()).unwrap();
    assert!(
        start_save(
            Kind::Complete,
            ImageOptions::default(),
            "test".into(),
            ctx.clone()
        )
        .is_err()
    );
    drop(map.snapshot);
    assert!(matches!(
        map.result.recv_timeout(Duration::from_secs(5)).unwrap(),
        capture::SaveResult::Failed(_)
    ));
    let (snapshot, job) = start_save(
        Kind::Complete,
        ImageOptions::default(),
        "test".into(),
        ctx.clone(),
    )
    .unwrap();
    assert!(capture::start_save("test".into(), ctx).is_err());
    drop(snapshot);
    assert!(matches!(
        job.result.recv_timeout(Duration::from_secs(5)).unwrap(),
        ca_app::metric_exports::SaveResult::Failed(_)
    ));
}
