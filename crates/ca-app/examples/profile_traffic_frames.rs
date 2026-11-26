//! Windowed ticket-34 CPU gate using the actual app and render callback.
// The normal binary uses App::new; this benchmark supplies its own document.
#[allow(dead_code)]
#[path = "../src/app.rs"]
mod app;
#[path = "../src/render.rs"]
mod render;
#[path = "../src/timing.rs"]
mod timing;

use ca_core::map_json::MapDocument;
use crossbeam_channel::bounded;
use eframe::egui;
use serde_json::json;

fn main() -> anyhow::Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let paused = args.iter().any(|arg| arg == "--paused");
    anyhow::ensure!(
        args.iter().all(|arg| arg == "--paused"
            || ["--streets=", "--frames=", "--rate="]
                .iter()
                .any(|key| arg.starts_with(key))),
        "usage: profile_traffic_frames [--paused] [--streets=N] [--frames=N] [--rate=N]"
    );
    let number = |key: &str, default: usize| -> anyhow::Result<usize> {
        args.iter()
            .find_map(|arg| arg.strip_prefix(key))
            .map_or(Ok(default), |value| Ok(value.parse()?))
    };
    let streets = number("--streets=", 2000)?;
    let frames = number("--frames=", 600)? as u64;
    let rate = number("--rate=", 60)?;
    anyhow::ensure!(
        (1..=2000).contains(&streets) && frames > 0,
        "invalid workload"
    );
    anyhow::ensure!((1..=60).contains(&rate), "invalid tick rate");
    let roads: Vec<_> = (0..streets)
        .map(|i| {
            json!({
                "nombre": format!("Road {i}"),
                "tipo": "generador", "tamano": 250, "carriles": 2,
                "x": (i % 40) * 1300, "y": (i / 40) * 20,
                "laneDirections": [1, -1],
                "probabilidadGeneracion": 0.35, "probabilidadSaltoDeCarril": 0.1
            })
        })
        .collect();
    let mut document = MapDocument::parse(&json!({"calles": roads}).to_string())?;
    document.model_mut().random_fill(0.5)?;
    let options = eframe::NativeOptions {
        renderer: eframe::Renderer::Wgpu,
        viewport: egui::ViewportBuilder::default().with_inner_size([1100., 850.]),
        ..Default::default()
    };
    let (tx, rx) = bounded(1);
    eframe::run_native(
        "Street update profiling",
        options,
        Box::new(move |cc| {
            Ok(Box::new(app::App::with_document(
                cc,
                Some(frames),
                tx,
                document,
                rate as f64,
                !paused,
            )?))
        }),
    )
    .map_err(|error| anyhow::anyhow!("{error}"))?;
    let report = rx.recv()?;
    anyhow::ensure!(report.error.is_none(), "{:?}", report.error);
    anyhow::ensure!(
        report.progress.frames >= frames,
        "profiling window closed before its frame limit: {}/{}",
        report.progress.frames,
        frames
    );
    println!(
        "paused={paused} streets={streets} rate={rate} frames={} ticks={} render_fps={:.1} simulation_fps={:.1} adapter={}",
        report.progress.frames,
        report.progress.generation,
        report.progress.render_fps,
        report.progress.fps,
        report.adapter,
    );
    Ok(())
}
