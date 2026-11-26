//! Capture adapters. Decode, GPU setup/readback, PNG encoding, dialogs and file I/O
//! run on a worker. The render callback supplies only an owned model snapshot.
mod reference;

use ca_core::{camera::WorldView, map_json::MapDocument};
use ca_gpu::{Capture, CaptureImage, CapturePlan, CapturedImage, TrafficScene, VehicleStyle};
use crossbeam_channel::{Receiver, Sender, bounded};
use eframe::{egui, wgpu};
use image::ImageEncoder;
use std::sync::atomic::{AtomicBool, Ordering};

static CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// One shared job limit for native whole-map and Complete Export captures.
pub(crate) struct CapturePermit;

impl CapturePermit {
    pub(crate) fn acquire() -> std::io::Result<Self> {
        CAPTURE_ACTIVE
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .map(|_| Self)
            .map_err(|_| {
                std::io::Error::new(std::io::ErrorKind::WouldBlock, "capture already running")
            })
    }
}

impl Drop for CapturePermit {
    fn drop(&mut self) {
        CAPTURE_ACTIVE.store(false, Ordering::Release);
    }
}

pub struct Snapshot {
    pub document: MapDocument,
    pub shift: [f32; 2],
    pub style: VehicleStyle,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
}

pub enum SaveResult {
    Saved,
    Cancelled,
    Failed(String),
}

pub struct SaveJob {
    pub snapshot: Sender<Snapshot>,
    pub result: Receiver<SaveResult>,
}

pub fn file_name(unix_millis: i64) -> Result<String, String> {
    let date = time::OffsetDateTime::from_unix_timestamp_nanos(i128::from(unix_millis) * 1_000_000)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "captura_pantalla_{:04}-{:02}-{:02}T{:02}-{:02}-{:02}-{:03}Z.png",
        date.year(),
        u8::from(date.month()),
        date.day(),
        date.hour(),
        date.minute(),
        date.second(),
        date.millisecond(),
    ))
}

pub fn encode_png(image: &CapturedImage) -> Result<Vec<u8>, String> {
    if image.pixels.contains(&0)
        || image.rgba.len() as u64 != u64::from(image.pixels[0]) * u64::from(image.pixels[1]) * 4
    {
        return Err("Invalid capture pixels".into());
    }
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(
            &image.rgba,
            image.pixels[0],
            image.pixels[1],
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| e.to_string())?;
    Ok(png)
}

/// Export seam for F11.4. `view` uses the snapshot's original shifted camera.
/// Call on a worker. No native dialog, camera mutation, or simulation step.
pub fn capture_viewport(
    snapshot: Snapshot,
    view: WorldView,
    pixels: [u32; 2],
) -> Result<CapturedImage, String> {
    render(snapshot, Some((view, pixels)))
}

pub fn capture_whole_map(snapshot: Snapshot) -> Result<CapturedImage, String> {
    render(snapshot, None)
}

fn render(
    snapshot: Snapshot,
    viewport: Option<(WorldView, [u32; 2])>,
) -> Result<CapturedImage, String> {
    let scene = TrafficScene::from_document(&snapshot.document);
    let plan = if let Some((mut view, pixels)) = viewport {
        for i in 0..2 {
            view.origin[i] += scene.shift()[i] - snapshot.shift[i];
        }
        CapturePlan::viewport(view, pixels)
    } else {
        CapturePlan::whole_map(&scene)
    }
    .ok_or_else(|| "capture.empty".to_owned())?;
    let images = artwork(&snapshot.document, scene.shift())?;
    Capture::start(
        &snapshot.device,
        &snapshot.queue,
        &scene,
        plan,
        snapshot.style,
        &images,
    )?
    .read_on_worker(&snapshot.device)
}

fn artwork(document: &MapDocument, shift: [f32; 2]) -> Result<Vec<CaptureImage>, String> {
    let mut images = Vec::new();
    let mut add = |building, corners: [[f64; 2]; 4], decoded: CapturedImage, opacity| {
        images.push(CaptureImage {
            building,
            corners: corners.map(|p| std::array::from_fn(|i| p[i] as f32 / 5. + shift[i])),
            pixels: decoded.pixels,
            rgba: decoded.rgba,
            opacity,
        });
    };
    if let Some(reference) = document.reference_image().filter(|r| r.visible) {
        let decoded = if let Some(data) = reference.data_url {
            reference::from_data(data)?
        } else {
            let fetch = || -> Result<CapturedImage, String> {
                let url = reference.url.ok_or("Missing reference URL")?;
                if !url.starts_with("https://") && !url.starts_with("http://") {
                    return Err("Invalid reference URL scheme".into());
                }
                let agent = ureq::Agent::new_with_config(
                    ureq::Agent::config_builder()
                        .timeout_global(Some(std::time::Duration::from_secs(15)))
                        .max_redirects(3)
                        .build(),
                );
                let bytes = agent
                    .get(url)
                    .call()
                    .map_err(|e| e.to_string())?
                    .body_mut()
                    .with_config()
                    .limit(reference::MAX_BYTES)
                    .read_to_vec()
                    .map_err(|e| e.to_string())?;
                reference::decode(&bytes)
            };
            fetch().map_err(|error| {
                tracing::warn!(%error, "reference image capture failed");
                "capture.referenceUnavailable".to_owned()
            })?
        };
        add(None, reference.corners, decoded, reference.opacity);
    }
    for (index, building) in document.buildings().iter().enumerate() {
        let decoded = if let Some(data) = building.image_data() {
            Some(crate::building_images::DecodedImage::from_data(data))
        } else {
            building.image_asset().map(|path| {
                ca_core::buildings::artwork::bytes(path)
                    .ok_or(ca_core::buildings::BuildingError("imageDecode"))
                    .and_then(crate::building_images::DecodedImage::from_bytes)
            })
        };
        if let Some(decoded) = decoded {
            let decoded = decoded.map_err(|e| e.translation_key())?;
            add(
                Some(index),
                building.corners(),
                CapturedImage {
                    pixels: decoded.pixels,
                    rgba: decoded.rgba,
                },
                1.,
            );
        }
    }
    Ok(images)
}

pub fn start_save(title: String, repaint: egui::Context) -> std::io::Result<SaveJob> {
    let permit = CapturePermit::acquire()?;
    let (snapshot, snapshots) = bounded(1);
    let (result_tx, result) = bounded(1);
    std::thread::Builder::new()
        .name("fluvi-map-capture".into())
        .spawn(move || {
            let result = (|| {
                let snapshot = snapshots.recv().map_err(|e| e.to_string())?;
                // Take the name at the request, not after a person closes the dialog.
                let millis = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_millis();
                let name = file_name(i64::try_from(millis).map_err(|e| e.to_string())?)?;
                let image = capture_whole_map(snapshot)?;
                let png = encode_png(&image)?;
                let Some(path) = rfd::FileDialog::new()
                    .set_title(title)
                    .add_filter("PNG", &["png"])
                    .set_file_name(name)
                    .save_file()
                else {
                    return Ok(SaveResult::Cancelled);
                };
                std::fs::write(path, png).map_err(|e| e.to_string())?;
                Ok(SaveResult::Saved)
            })()
            .unwrap_or_else(SaveResult::Failed);
            drop(permit);
            let _ = result_tx.try_send(result);
            repaint.request_repaint();
        })?;
    Ok(SaveJob { snapshot, result })
}
