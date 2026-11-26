use super::{Context, Snapshot, build_csv, build_image_zip, standalone_json};
use crate::capture::SaveResult;
use crossbeam_channel::{Receiver, Sender, bounded};
use eframe::egui;

#[derive(Clone, Copy)]
pub enum Kind {
    Csv,
    Json,
    Images,
}

impl Kind {
    pub fn key(self) -> &'static str {
        match self {
            Self::Csv => "metrics.export.csv",
            Self::Json => "metrics.export.json",
            Self::Images => "metrics.export.images",
        }
    }
}

pub struct SaveJob {
    pub result: Receiver<SaveResult>,
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
    title: String,
    repaint: egui::Context,
) -> std::io::Result<(Sender<Snapshot>, SaveJob)> {
    let (snapshot, snapshots) = bounded::<Snapshot>(1);
    let (result_tx, result) = bounded(1);
    std::thread::Builder::new()
        .name("fluvi-metric-export".into())
        .spawn(move || {
            let result = (|| {
                let snapshot = snapshots.recv().map_err(|e| e.to_string())?;
                // This owned export can finish even if the live map is later replaced.
                if snapshot.history.is_empty() {
                    return Err("metrics.export.empty".into());
                }
                let context = Context {
                    time: snapshot.document.time().clone(),
                    export_date: timestamp(),
                };
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
                        build_image_zip(&snapshot.history, &snapshot.document, snapshot.included)?,
                        format!(
                            "metricas_imagenes_{}.zip",
                            context.export_date.replace([':', '.'], "-")
                        ),
                        "zip",
                    ),
                };
                let Some(path) = rfd::FileDialog::new()
                    .set_title(title)
                    .add_filter(extension, &[extension])
                    .set_file_name(name)
                    .save_file()
                else {
                    return Ok(SaveResult::Cancelled);
                };
                std::fs::write(path, bytes).map_err(|e| e.to_string())?;
                Ok(SaveResult::Saved)
            })()
            .unwrap_or_else(SaveResult::Failed);
            let _ = result_tx.try_send(result);
            repaint.request_repaint();
        })?;
    Ok((snapshot, SaveJob { result }))
}
