use super::{
    Context, ImageOptions, Snapshot, build_csv, images::build_image_zip_reporting, standalone_json,
};
use crate::job_progress::{Progress, Stage};
use crate::shell::Severity;
use crossbeam_channel::{Receiver, Sender, bounded};
use eframe::egui;

#[derive(Clone, Copy)]
pub enum Kind {
    Csv,
    Json,
    Images,
    Complete,
}

impl Kind {
    pub fn key(self) -> &'static str {
        match self {
            Self::Csv => "metrics.export.csv",
            Self::Json => "metrics.export.json",
            Self::Images => "metrics.export.images",
            Self::Complete => "metrics.export.complete",
        }
    }
}

pub struct SaveJob {
    pub result: Receiver<SaveResult>,
    pub progress: Progress,
}

pub enum SaveResult {
    Saved,
    SavedWithoutAnalysis(String),
    Cancelled,
    Failed(String),
}

impl SaveResult {
    pub fn notice(&self) -> (Severity, &'static str) {
        match self {
            Self::Saved => (Severity::Success, "metrics.export.saved"),
            Self::SavedWithoutAnalysis(error) => {
                tracing::warn!(%error, "metric export saved without analysis");
                (Severity::Warning, "metrics.export.analysisFailed")
            }
            Self::Cancelled => (Severity::Info, "metrics.export.cancelled"),
            Self::Failed(error) => {
                tracing::warn!(%error, "metric export failed");
                (
                    Severity::Error,
                    if error == "metrics.export.empty" {
                        "metrics.export.empty"
                    } else {
                        "metrics.export.failed"
                    },
                )
            }
        }
    }
}

/// Worker-only final save boundary. Analysis warnings require a successful write.
pub fn save_file(
    path: &std::path::Path,
    bytes: &[u8],
    analysis_error: Option<String>,
) -> SaveResult {
    match std::fs::write(path, bytes) {
        Err(error) => SaveResult::Failed(error.to_string()),
        Ok(()) => match analysis_error {
            Some(error) => SaveResult::SavedWithoutAnalysis(error),
            None => SaveResult::Saved,
        },
    }
}

fn timestamp() -> String {
    let now = time::OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
        now.millisecond()
    )
}

/// The sender is transferred to the render request, not retained in the job.
/// Dropping a cancelled request therefore wakes the waiting worker.
pub fn start_save(
    kind: Kind,
    options: ImageOptions,
    title: String,
    repaint: egui::Context,
) -> std::io::Result<(Sender<Snapshot>, SaveJob)> {
    let capture_permit = if matches!(kind, Kind::Complete) {
        Some(crate::capture::CapturePermit::acquire()?)
    } else {
        None
    };
    let (snapshot, snapshots) = bounded::<Snapshot>(1);
    let (result_tx, result) = bounded(1);
    let progress = Progress::default();
    let worker_progress = progress.clone();
    std::thread::Builder::new()
        .name("fluvi-metric-export".into())
        .spawn(move || {
            let result = (|| {
                let snapshot = snapshots.recv().map_err(|e| e.to_string())?;
                worker_progress.set(10, Stage::Packing);
                // This owned export can finish even if the live map is later replaced.
                if snapshot.history.is_empty() {
                    return Err("metrics.export.empty".into());
                }
                let context = Context {
                    time: snapshot.document.time().clone(),
                    export_date: timestamp(),
                };
                let mut analysis_error = None;
                let (bytes, name, extension) = match kind {
                    Kind::Csv | Kind::Json => {
                        let file = if matches!(kind, Kind::Csv) {
                            build_csv(&snapshot.history, &context)
                        } else {
                            standalone_json(&snapshot.history, &context)
                        };
                        (
                            file.content.into_bytes(),
                            file.file_name,
                            if matches!(kind, Kind::Csv) {
                                "csv"
                            } else {
                                "json"
                            },
                        )
                    }
                    Kind::Images => (
                        build_image_zip_reporting(
                            &snapshot.history,
                            &snapshot.document,
                            snapshot.included,
                            options,
                            |done| worker_progress.set(10 + done as u8 * 10, Stage::Images),
                        )?,
                        format!(
                            "metricas_imagenes_{}.zip",
                            context.export_date.replace([':', '.'], "-")
                        ),
                        "zip",
                    ),
                    Kind::Complete => {
                        worker_progress.set(15, Stage::Images);
                        let viewport = snapshot
                            .viewport
                            .as_ref()
                            .ok_or("Missing export viewport")?
                            .capture(&snapshot.document)?;
                        let prepared = super::CompleteExport::prepare(
                            &snapshot, &context, &viewport, options,
                        )?;
                        worker_progress.set(65, Stage::Analyzing);
                        let archive = prepared.finish()?;
                        analysis_error = archive.analysis_error;
                        worker_progress.set(85, Stage::Packing);
                        (
                            archive.bytes,
                            format!(
                                "exportacion_completa_{}.zip",
                                context.export_date.replace([':', '.'], "-")
                            ),
                            "zip",
                        )
                    }
                };
                worker_progress.set(90, Stage::ChooseFile);
                let Some(path) = rfd::FileDialog::new()
                    .set_title(title)
                    .add_filter(extension, &[extension])
                    .set_file_name(name)
                    .save_file()
                else {
                    return Ok(SaveResult::Cancelled);
                };
                worker_progress.set(95, Stage::Writing);
                let saved = save_file(&path, &bytes, analysis_error);
                if matches!(
                    saved,
                    SaveResult::Saved | SaveResult::SavedWithoutAnalysis(_)
                ) {
                    worker_progress.set(100, Stage::Ready);
                }
                Ok(saved)
            })()
            .unwrap_or_else(SaveResult::Failed);
            drop(capture_permit);
            let _ = result_tx.try_send(result);
            repaint.request_repaint();
        })?;
    Ok((snapshot, SaveJob { result, progress }))
}
