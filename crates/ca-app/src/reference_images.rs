//! Reference artwork and its editor share the capture decoder.
pub mod codec;
mod gesture;
pub use gesture::{Gesture, Handle};
mod editor;
pub use editor::{Editor, Status};

use base64::{Engine, engine::general_purpose::STANDARD};
use crossbeam_channel::{Receiver, bounded};
use std::{io::Read, path::PathBuf, time::Duration};

pub enum Source {
    Data(String),
    Url(String),
    File(PathBuf),
    FileDialog(String),
}

pub struct Loaded {
    pub image: ca_gpu::CapturedImage,
    pub data_url: Option<String>,
}

pub type LoadResult = Result<Option<Loaded>, String>;

/// Worker-only bounded HTTP read. The timeout includes redirects and the body.
pub fn download(url: &str, timeout: Duration) -> Result<ca_gpu::CapturedImage, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Invalid reference URL scheme".into());
    }
    let agent = ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(timeout))
            .max_redirects(3)
            .build(),
    );
    let bytes = agent
        .get(url)
        .call()
        .map_err(|e| e.to_string())?
        .body_mut()
        .with_config()
        .limit(codec::MAX_BYTES)
        .read_to_vec()
        .map_err(|e| e.to_string())?;
    codec::decode(&bytes)
}

fn file(path: PathBuf) -> LoadResult {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|f| f.take(codec::MAX_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|e| e.to_string())?;
    let image = codec::decode(&bytes)?;
    let mime = image::guess_format(&bytes)
        .ok()
        .and_then(|f| f.to_mime_type().strip_prefix("image/"))
        .unwrap_or("svg+xml");
    Ok(Some(Loaded {
        image,
        data_url: Some(format!(
            "data:image/{mime};base64,{}",
            STANDARD.encode(bytes)
        )),
    }))
}

pub fn start(source: Source, repaint: egui::Context) -> std::io::Result<Receiver<LoadResult>> {
    let (tx, rx) = bounded(1);
    std::thread::Builder::new()
        .name("fluvi-reference-image".into())
        .spawn(move || {
            let result = match source {
                Source::Data(data) => codec::from_data(&data).map(|image| {
                    Some(Loaded {
                        image,
                        data_url: None,
                    })
                }),
                Source::Url(url) => download(&url, Duration::from_secs(15)).map(|image| {
                    Some(Loaded {
                        image,
                        data_url: None,
                    })
                }),
                Source::File(path) => file(path),
                Source::FileDialog(title) => match rfd::FileDialog::new()
                    .set_title(title)
                    .add_filter(
                        "Images",
                        &["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico", "svg"],
                    )
                    .pick_file()
                {
                    Some(path) => file(path),
                    None => Ok(None),
                },
            };
            // Map replacement drops the receiver; late work cannot install artwork.
            let _ = tx.try_send(result);
            repaint.request_repaint();
        })?;
    Ok(rx)
}
