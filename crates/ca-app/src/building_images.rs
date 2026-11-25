//! Image decoding and native file access run on workers, never in a frame callback.
use base64::{Engine, engine::general_purpose::STANDARD};
use ca_core::buildings::BuildingError;
use crossbeam_channel::{Receiver, bounded};
use std::io::{Cursor, Read};

pub const MAX_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug)]
pub struct DecodedImage {
    pub data: String,
    pub pixels: [u32; 2],
    pub rgba: Vec<u8>,
}

impl DecodedImage {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, BuildingError> {
        if bytes.len() > MAX_BYTES {
            return Err(BuildingError("imageTooLarge"));
        }
        let format = image::guess_format(bytes).map_err(|_| BuildingError("imageType"))?;
        let mime = match format {
            image::ImageFormat::Png => "png",
            image::ImageFormat::Jpeg => "jpeg",
            image::ImageFormat::WebP => "webp",
            _ => return Err(BuildingError("imageType")),
        };
        let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
        let (width, height) = image::ImageReader::with_format(Cursor::new(bytes), format)
            .into_dimensions()
            .map_err(|_| BuildingError("imageDecode"))?;
        if u64::from(width) * u64::from(height) * 4 > 64 * 1024 * 1024 {
            return Err(BuildingError("imageDecode"));
        }
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(64 * 1024 * 1024);
        reader.limits(limits);
        let decoded = reader
            .decode()
            .map_err(|_| BuildingError("imageDecode"))?
            .into_rgba8();
        Ok(Self {
            data: format!("data:image/{mime};base64,{}", STANDARD.encode(bytes)),
            pixels: [decoded.width(), decoded.height()],
            rgba: decoded.into_raw(),
        })
    }

    pub fn from_data(data: &str) -> Result<Self, BuildingError> {
        let (header, encoded) = data.split_once(',').ok_or(BuildingError("imageType"))?;
        if ![
            "data:image/png;base64",
            "data:image/jpeg;base64",
            "data:image/webp;base64",
        ]
        .contains(&header)
        {
            return Err(BuildingError("imageType"));
        }
        if encoded.len() > MAX_BYTES.div_ceil(3) * 4 {
            return Err(BuildingError("imageTooLarge"));
        }
        let bytes = STANDARD
            .decode(encoded)
            .map_err(|_| BuildingError("imageDecode"))?;
        let mut decoded = Self::from_bytes(&bytes)?;
        if decoded.data.split_once(',').map(|p| p.0) != Some(header) {
            return Err(BuildingError("imageType"));
        }
        // Retain the exact original data URL, including base64 representation.
        decoded.data = data.into();
        Ok(decoded)
    }
}

pub enum Source {
    Data(String),
    Bundled(&'static str),
    FileDialog(String),
}

pub type ImageResult = Result<Option<DecodedImage>, BuildingError>;

pub fn start(source: Source, repaint: egui::Context) -> std::io::Result<Receiver<ImageResult>> {
    let (tx, rx) = bounded(1);
    std::thread::Builder::new()
        .name("fluvi-building-image".into())
        .spawn(move || {
            let result = match source {
                Source::Data(data) => DecodedImage::from_data(&data).map(Some),
                Source::Bundled(path) => ca_core::buildings::artwork::bytes(path)
                    .ok_or(BuildingError("imageDecode"))
                    .and_then(DecodedImage::from_bytes)
                    .map(Some),
                Source::FileDialog(title) => {
                    match rfd::FileDialog::new()
                        .set_title(title)
                        .add_filter("PNG / JPEG / WebP", &["png", "jpg", "jpeg", "webp"])
                        .pick_file()
                    {
                        None => Ok(None),
                        Some(path) => (|| {
                            let mut bytes = Vec::new();
                            std::fs::File::open(path)
                                .and_then(|f| f.take(MAX_BYTES as u64 + 1).read_to_end(&mut bytes))
                                .map_err(|_| BuildingError("imageDecode"))?;
                            DecodedImage::from_bytes(&bytes).map(Some)
                        })(),
                    }
                }
            };
            // Dropping the receiver cancels this job. A late decode cannot change a map.
            let _ = tx.try_send(result);
            repaint.request_repaint();
        })?;
    Ok(rx)
}
