//! Native dialogs and disk access stay off the UI/render thread.
use ca_core::map_json::MapDocument;
use crossbeam_channel::{Receiver, bounded};
use std::io::Read;

pub enum FileResult {
    Opened(MapDocument),
    Saved,
    Cancelled,
    Failed(&'static str),
}

pub fn start(
    save: Option<String>,
    title: String,
    repaint: egui::Context,
) -> std::io::Result<Receiver<FileResult>> {
    let (tx, rx) = bounded(1);
    std::thread::Builder::new()
        .name("fluvi-map-file".into())
        .spawn(move || {
            let dialog = rfd::FileDialog::new()
                .set_title(title)
                .add_filter("JSON", &["json"]);
            let result = if let Some(text) = save {
                match dialog.set_file_name("map.json").save_file() {
                    None => FileResult::Cancelled,
                    Some(path) => match std::fs::write(path, &text) {
                        Ok(()) => FileResult::Saved,
                        Err(_) => FileResult::Failed("mapFiles.saveError"),
                    },
                }
            } else {
                match dialog.pick_file() {
                    None => FileResult::Cancelled,
                    Some(path) => {
                        let mut text = String::new();
                        match std::fs::File::open(path)
                            .and_then(|f| f.take(16 * 1024 * 1024 + 1).read_to_string(&mut text))
                        {
                            Ok(_) if text.len() <= 16 * 1024 * 1024 => {
                                match MapDocument::parse(&text) {
                                    Ok(map) => FileResult::Opened(map),
                                    Err(error) => FileResult::Failed(error.translation_key()),
                                }
                            }
                            _ => FileResult::Failed("mapFiles.invalidFile"),
                        }
                    }
                }
            };
            let _ = tx.try_send(result);
            repaint.request_repaint();
        })?;
    Ok(rx)
}
