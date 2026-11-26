//! Reference artwork is not a building upload. Keep its codec and limits separate.
use ca_gpu::CapturedImage;
use std::io::Cursor;

pub(super) const MAX_BYTES: u64 = 16 * 1024 * 1024;

pub(super) fn from_data(data: &str) -> Result<CapturedImage, String> {
    if data.len() as u64 > MAX_BYTES * 4 + 1024 {
        return Err("Reference image data URL is too large".into());
    }
    let url = data_url::DataUrl::process(data).map_err(|e| e.to_string())?;
    let (bytes, _) = url.decode_to_vec().map_err(|e| e.to_string())?;
    decode(&bytes)
}

pub(super) fn decode(bytes: &[u8]) -> Result<CapturedImage, String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Reference image exceeds 16 MiB".into());
    }
    if let Ok(format) = image::guess_format(bytes) {
        let dimensions = image::ImageReader::with_format(Cursor::new(bytes), format)
            .into_dimensions()
            .map_err(|e| e.to_string())?;
        if dimensions.0 > 8192
            || dimensions.1 > 8192
            || u64::from(dimensions.0) * u64::from(dimensions.1) * 4 > 64 * 1024 * 1024
        {
            return Err("Reference image exceeds decoded pixel limits".into());
        }
        let mut reader = image::ImageReader::with_format(Cursor::new(bytes), format);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        limits.max_alloc = Some(64 * 1024 * 1024);
        reader.limits(limits);
        // Animated references capture their first frame, without changing live playback.
        let decoded = reader.decode().map_err(|e| e.to_string())?.into_rgba8();
        return Ok(CapturedImage {
            pixels: [decoded.width(), decoded.height()],
            rgba: decoded.into_raw(),
        });
    }
    let mut options = resvg::usvg::Options::default();
    // Imported SVGs may contain file paths. Only embedded artwork is allowed.
    options.image_href_resolver.resolve_string = Box::new(|_, _| None);
    options.fontdb_mut().load_system_fonts();
    let tree = resvg::usvg::Tree::from_data(bytes, &options).map_err(|e| e.to_string())?;
    let size = tree.size();
    let scale = 2400. / size.width().max(size.height());
    let pixels = [size.width(), size.height()].map(|n| (n * scale).round().max(1.) as u32);
    let mut pixmap = resvg::tiny_skia::Pixmap::new(pixels[0], pixels[1])
        .ok_or("Cannot allocate reference SVG")?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    // tiny-skia stores premultiplied pixels; the capture texture uses straight alpha.
    let rgba = pixmap
        .pixels()
        .iter()
        .flat_map(|pixel| {
            let pixel = pixel.demultiply();
            [pixel.red(), pixel.green(), pixel.blue(), pixel.alpha()]
        })
        .collect();
    Ok(CapturedImage { pixels, rgba })
}
