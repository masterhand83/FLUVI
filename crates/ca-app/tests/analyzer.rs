use ca_analysis::Format;
use ca_app::{analyzer::analyze_with_images, shell::Language};

const INPUT: &str = include_str!("../../ca-analysis/tests/fixtures/input.json");

fn drive_until_idle(session: &mut ca_app::analyzer::Session) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while session.is_busy() {
        session.poll();
        assert!(
            std::time::Instant::now() < deadline,
            "worker did not finish"
        );
        std::thread::yield_now();
    }
}

#[test]
fn headless_analysis_returns_the_same_numbers_and_three_translated_pngs() {
    let es = analyze_with_images(INPUT, Format::Json, Language::Spanish).unwrap();
    let en = analyze_with_images(INPUT, Format::Json, Language::English).unwrap();
    assert_eq!(es.report.results, en.report.results);
    assert_eq!(es.plots.len(), 3);
    for (a, b) in es.plots.iter().zip(&en.plots) {
        assert_eq!(a.file_name, b.file_name);
        assert_ne!(a.png, b.png, "translated plot text must change");
        let raster = image::load_from_memory(&a.png).unwrap().to_rgba8();
        assert_eq!(raster.width(), 1600);
        assert!(raster.pixels().all(|p| p[3] == 255));
        assert!(raster.pixels().filter(|p| p[0] < 200).count() > 1000);
        assert!(!a.svg.contains("NaN"));
    }
    assert!(es.plots[0].svg.contains("Densidad"));
    assert!(en.plots[0].svg.contains("Density"));
    assert!(es.plots[1].svg.contains("Lunes"));
    assert!(en.plots[1].svg.contains("Monday"));
    assert!(es.plots[2].svg.contains("Frecuencia"));
    assert!(en.plots[2].svg.contains("Frequency"));
}

#[test]
fn closing_during_a_run_discards_the_result_even_after_reopening() {
    use ca_app::analyzer::{Analysis, Session};
    let (started, starts) = crossbeam_channel::bounded(1);
    let (release, releases) = crossbeam_channel::bounded(1);
    let mut session = Session::with_processor(move |content, format, language| {
        started.send(()).unwrap();
        releases.recv().unwrap();
        Ok(Analysis {
            report: ca_analysis::analyze(content, format).unwrap(),
            plots: vec![],
            language,
        })
    })
    .unwrap();
    session.open();
    session.load(INPUT.into(), Format::Json, Language::Spanish);
    session.poll();
    starts
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    session.close();
    release.send(()).unwrap();
    session.open();
    session.load(INPUT.into(), Format::Json, Language::English);
    session.poll();
    starts
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    session.poll();
    assert!(
        session.analysis().is_none(),
        "closed run appeared in reopened dialog"
    );
    release.send(()).unwrap();
    drive_until_idle(&mut session);
    assert_eq!(session.analysis().unwrap().language, Language::English);
}

#[test]
fn new_files_replace_running_and_queued_requests_without_showing_old_results() {
    use ca_app::analyzer::{Analysis, Session};
    let (started, starts) = crossbeam_channel::bounded(1);
    let (release, releases) = crossbeam_channel::bounded(1);
    let mut session = Session::with_processor(move |content, format, language| {
        started.send(()).unwrap();
        releases.recv().unwrap();
        Ok(Analysis {
            report: ca_analysis::analyze(content, format).unwrap(),
            plots: vec![],
            language,
        })
    })
    .unwrap();
    session.open();
    session.load(INPUT.into(), Format::Json, Language::Spanish);
    session.poll();
    starts
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap();
    // A queued malformed file is superseded before the worker can read it.
    session.load("{".into(), Format::Json, Language::Spanish);
    session.poll();
    session.load(
        INPUT.replace("0.5,", "0.75,"),
        Format::Json,
        Language::English,
    );
    session.poll();
    release.send(()).unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while starts.try_recv().is_err() {
        session.poll();
        assert!(session.analysis().is_none(), "old file appeared");
        assert!(
            std::time::Instant::now() < deadline,
            "latest request did not start"
        );
        std::thread::yield_now();
    }
    release.send(()).unwrap();
    drive_until_idle(&mut session);
    assert!(session.error_key().is_none());
    assert_eq!(session.analysis().unwrap().language, Language::English);
    assert_eq!(
        session.analysis().unwrap().report.samples[0].values[1],
        0.75
    );
}

#[test]
fn changing_language_redraws_plots_without_changing_numeric_results() {
    use ca_app::analyzer::Session;
    let mut session = Session::default();
    session.open();
    session.load(INPUT.into(), Format::Json, Language::Spanish);
    drive_until_idle(&mut session);
    let numbers = session.analysis().unwrap().report.results.clone();
    session.set_language(Language::English);
    drive_until_idle(&mut session);
    let analysis = session.analysis().unwrap();
    assert_eq!(analysis.report.results, numbers);
    assert_eq!(analysis.language, Language::English);
    assert!(analysis.plots[0].svg.contains("Density"));
}

#[test]
fn malformed_files_show_translated_errors_and_no_old_analysis() {
    use ca_app::{analyzer::Session, shell::Translator};
    let mut session = Session::default();
    session.open();
    session.load("{".into(), Format::Json, Language::English);
    drive_until_idle(&mut session);
    assert!(session.analysis().is_none());
    let key = session.error_key().unwrap();
    let es = Translator::new(Language::Spanish).tr(key, &[]);
    let en = Translator::new(Language::English).tr(key, &[]);
    assert!(es.starts_with("Archivo de métricas no válido"));
    assert!(en.starts_with("Invalid metrics file"));
    assert_ne!(es, en);
}

#[test]
fn dialog_renders_the_error_and_escape_discards_it() {
    use ca_app::{analyzer::AnalyzerDialog, shell::Shell};
    let mut dialog = AnalyzerDialog::default();
    dialog.open();
    dialog
        .session
        .load("{".into(), Format::Json, Language::Spanish);
    drive_until_idle(&mut dialog.session);
    let ctx = egui::Context::default();
    let shell = Shell::load(None);
    // The first egui window frame measures its contents without painting them.
    let _ = ctx.run(Default::default(), |ctx| dialog.show(ctx, &shell));
    let output = ctx.run(Default::default(), |ctx| dialog.show(ctx, &shell));
    let text = output
        .shapes
        .iter()
        .filter_map(|s| {
            if let egui::Shape::Text(t) = &s.shape {
                Some(t.galley.text())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("Archivo de métricas no válido"), "{text}");
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
        |ctx| dialog.show(ctx, &shell),
    );
    assert!(!dialog.session.is_open());
    assert!(dialog.session.error_key().is_none());
}
