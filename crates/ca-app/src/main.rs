mod app;
mod render;
mod timing;

use anyhow::{Context, bail, ensure};
use crossbeam_channel::bounded;
use eframe::{egui, wgpu};
use tracing_subscriber::EnvFilter;

fn smoke_frames(args: impl IntoIterator<Item = String>) -> anyhow::Result<Option<u64>> {
    let mut args = args.into_iter();
    match args.next().as_deref() {
        None => Ok(None),
        Some("--smoke-frames") => {
            let frames = args
                .next()
                .context("--smoke-frames needs a positive integer")?
                .parse::<u64>()?;
            ensure!(frames > 0, "--smoke-frames must be positive");
            ensure!(args.next().is_none(), "unexpected extra argument");
            Ok(Some(frames))
        }
        Some(arg) => bail!("unknown argument: {arg}; usage: ca-app [--smoke-frames N]"),
    }
}

fn main() -> anyhow::Result<()> {
    let smoke = smoke_frames(std::env::args().skip(1))?;
    let filter = match std::env::var("RUST_LOG") {
        Ok(filter) => EnvFilter::try_new(filter).context("invalid RUST_LOG")?,
        Err(_) => EnvFilter::new(
            "warn,ca_app=info,ca_gpu=info,ca_analysis=info,ca_core=info,wgpu=warn,naga=warn",
        ),
    };
    tracing_subscriber::fmt().with_env_filter(filter).init();
    let options = eframe::NativeOptions {
        renderer: eframe::Renderer::Wgpu,
        viewport: egui::ViewportBuilder::default()
            .with_title("FLUVI")
            .with_inner_size([1100.0, 850.0])
            .with_min_inner_size([640.0, 480.0]),
        wgpu_options: egui_wgpu::WgpuConfiguration {
            wgpu_setup: egui_wgpu::WgpuSetupCreateNew {
                instance_descriptor: wgpu::InstanceDescriptor::from_env_or_default(),
                ..Default::default()
            }
            .into(),
            ..Default::default()
        },
        ..Default::default()
    };
    let (report_tx, report_rx) = bounded(1);
    eframe::run_native(
        "FLUVI",
        options,
        Box::new(move |cc| Ok(Box::new(app::App::new(cc, smoke, report_tx)?))),
    )
    .map_err(|error| anyhow::anyhow!("native window failed: {error}"))?;
    let report = report_rx
        .try_recv()
        .context("application closed without a shutdown report")?;
    if smoke.is_some() {
        println!(
            "smoke frames={} ticks={} final_population={} simulation_fps={:.1} adapter={}",
            report.progress.frames,
            report.progress.generation,
            report.progress.population,
            report.progress.fps,
            report.adapter
        );
        ensure!(
            report.progress.frames >= smoke.unwrap_or_default(),
            "smoke closed before its frame limit"
        );
        ensure!(report.progress.generation > 0, "smoke: no ticks simulated");
        ensure!(report.progress.population > 0, "smoke: no vehicles");
    }
    if let Some(error) = report.error {
        bail!(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn smoke_cli_validates_arguments() {
        let parse = |args: &[&str]| smoke_frames(args.iter().map(|s| (*s).to_owned()));
        assert_eq!(parse(&[]).unwrap(), None);
        assert_eq!(parse(&["--smoke-frames", "180"]).unwrap(), Some(180));
        for args in [
            vec!["--smoke-frames"],
            vec!["--smoke-frames", "0"],
            vec!["--smoke-frames", "no"],
            vec!["--smoke-frames", "1", "extra"],
            vec!["--other"],
        ] {
            assert!(parse(&args).is_err());
        }
    }
}
