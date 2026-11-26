//! CPU-only report rendering: SVG plots rasterized by the existing resvg backend.
//! No window, egui context, GPU device, or mutable live chart is used.
use super::ImageOptions;
use crate::{metrics::Metric, shell::Translator};
use ca_core::{heatmap::Snapshot, map_json::MapDocument, metrics::Point};
use image::ImageEncoder;
use resvg::{tiny_skia, usvg};
use std::io::{Cursor, Write};

const WIDTH: u32 = 1600;
const CHARTS: [(&str, Metric); 5] = [
    ("densidad.png", Metric::Density),
    ("flujo_vehicular.png", Metric::Throughput),
    ("velocidad.png", Metric::Speed),
    ("tasa_de_cambio.png", Metric::NetChange),
    ("entropia.png", Metric::Entropy),
];

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn text(svg: &mut String, x: f64, y: f64, size: u32, anchor: &str, content: &str) {
    svg.push_str(&format!(
        "<text x='{x}' y='{y}' font-family='sans-serif' font-size='{size}' text-anchor='{anchor}' fill='#172033'>{}</text>",
        escape(content)
    ));
}

fn report(height: u32) -> String {
    format!(
        "<svg xmlns='http://www.w3.org/2000/svg' width='{WIDTH}' height='{height}'><rect width='100%' height='100%' fill='white'/>"
    )
}

fn rasterize(
    mut svg: String,
    options: &usvg::Options<'_>,
    scale: f32,
) -> Result<tiny_skia::Pixmap, String> {
    svg.push_str("</svg>");
    let tree = usvg::Tree::from_str(&svg, options).map_err(|e| e.to_string())?;
    let size = tree.size();
    let mut pixmap = tiny_skia::Pixmap::new(
        (size.width() * scale).round() as u32,
        (size.height() * scale).round() as u32,
    )
    .ok_or("Cannot allocate metric image")?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    Ok(pixmap)
}

fn png(pixmap: &tiny_skia::Pixmap, samples: u32) -> Result<Vec<u8>, String> {
    // All report pixels are opaque, so premultiplied and straight RGBA are equal.
    let reduced = if samples > 1 {
        let view = image::ImageBuffer::<image::Rgba<u8>, _>::from_raw(
            pixmap.width(),
            pixmap.height(),
            pixmap.data(),
        )
        .ok_or("Invalid metric raster")?;
        Some(image::imageops::resize(
            &view,
            pixmap.width() / samples,
            pixmap.height() / samples,
            image::imageops::FilterType::CatmullRom,
        ))
    } else {
        None
    };
    let (data, width, height) = reduced
        .as_ref()
        .map_or((pixmap.data(), pixmap.width(), pixmap.height()), |image| {
            (image.as_raw().as_slice(), image.width(), image.height())
        });
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(data, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}

fn chart(history: &[Point], metric: Metric, tr: &Translator) -> String {
    let mut svg = report(746);
    let title = history
        .last()
        .map(|p| format!("{} — {}", tr.tr(metric.key(), &[]), metric.formatted(*p)))
        .unwrap_or_else(|| tr.tr(metric.key(), &[]));
    text(&mut svg, 80., 60., 32, "start", &title);
    text(
        &mut svg,
        80.,
        103.,
        24,
        "start",
        &tr.tr(metric.axis_key(), &[]),
    );
    let (min, max) = metric.range(history);
    let y = |v: f64| 620. - (v - min) / (max - min) * 480.;
    let x = |i: usize| {
        180. + if history.len() <= 1 {
            650.
        } else {
            i as f64 / (history.len() - 1) as f64 * 1300.
        }
    };
    for i in 0..=4 {
        let value = min + (max - min) * i as f64 / 4.;
        let y = y(value);
        svg.push_str(&format!("<path d='M180 {y} H1480' stroke='#e2e8f0'/>"));
        text(&mut svg, 165., y + 8., 23, "end", &metric.tick_label(value));
    }
    svg.push_str(&format!(
        "<path d='M180 {} H1480 M180 140 V620' fill='none' stroke='#64748b' stroke-width='2'/>",
        y(0.)
    ));
    if !history.is_empty() {
        let ticks = history.len().min(6);
        for tick in 0..ticks {
            let i = if ticks == 1 {
                0
            } else {
                tick * (history.len() - 1) / (ticks - 1)
            };
            let x = x(i);
            svg.push_str(&format!("<path d='M{x} 140 V620' stroke='#e2e8f0'/><path d='M{x} 620 V628' stroke='#64748b'/>"));
            text(
                &mut svg,
                x,
                660.,
                21,
                "middle",
                &format!(
                    "{} {}",
                    tr.tr(history[i].clock.day_key(), &[]),
                    history[i].clock.numeric()
                ),
            );
        }
    }
    // Draw thin traces after the grid so grid lines cannot hide the data.
    let color = metric.colour(false);
    let rgb = format!("#{:02x}{:02x}{:02x}", color.r(), color.g(), color.b());
    let mut path = String::new();
    for (i, &p) in history.iter().enumerate() {
        path.push_str(&format!(
            "{} {:.3} {:.3} ",
            if i == 0 { "M" } else { "L" },
            x(i),
            y(metric.value(p))
        ));
    }
    svg.push_str(&format!(
        "<path d='{path}' fill='none' stroke='{rgb}' stroke-width='1.5' stroke-linejoin='round'/>"
    ));
    if history.len() == 1 {
        svg.push_str(&format!(
            "<circle cx='{}' cy='{}' r='5' fill='{rgb}'/>",
            x(0),
            y(metric.value(history[0]))
        ));
    }
    text(
        &mut svg,
        800.,
        716.,
        26,
        "middle",
        &tr.tr("metrics.axis.time", &[]),
    );
    svg
}

fn summary(history: &[Point], document: &MapDocument, included: usize, tr: &Translator) -> String {
    let mut svg = report(1050);
    text(
        &mut svg,
        80.,
        70.,
        34,
        "start",
        &tr.tr("metrics.report.summary", &[]),
    );
    if let Some(&point) = history.last() {
        text(
            &mut svg,
            80.,
            135.,
            30,
            "start",
            &tr.tr(point.status().key(), &[]),
        );
        text(
            &mut svg,
            80.,
            185.,
            24,
            "start",
            &tr.tr(point.status().observation_key(), &[]),
        );
        for (i, metric) in Metric::ALL.iter().enumerate() {
            let y = 285. + i as f64 * 85.;
            svg.push_str(&format!(
                "<rect x='48' y='{}' width='1504' height='80' fill='#f5f7fa'/>",
                y - 50.
            ));
            text(&mut svg, 80., y, 26, "start", &tr.tr(metric.key(), &[]));
            text(&mut svg, 1450., y, 28, "end", &metric.formatted(point));
        }
    } else {
        text(
            &mut svg,
            80.,
            135.,
            28,
            "start",
            &tr.tr("metrics.noData", &[]),
        );
    }
    for (i, note) in [
        tr.tr(
            "metrics.report.history",
            &[("count", &history.len().to_string())],
        ),
        tr.tr("metrics.report.latest", &[]),
        tr.tr(
            "metrics.report.roads",
            &[
                ("included", &included.to_string()),
                ("total", &document.layout().len().to_string()),
            ],
        ),
        tr.tr("metrics.report.heatmapNote", &[]),
    ]
    .iter()
    .enumerate()
    {
        text(&mut svg, 80., 800. + i as f64 * 50., 25, "start", note);
    }
    svg
}

fn heatmap(
    document: &MapDocument,
    options: &usvg::Options<'_>,
    scale: f32,
    export: ImageOptions,
    tr: &Translator,
) -> Result<tiny_skia::Pixmap, String> {
    // Never use a cached dialog frame: compute from this export's live snapshot.
    let frame = Snapshot::from_document(document);
    let image = crate::heatmap::render_on_white_with_quality(
        &frame,
        [
            (1504. * scale).round() as usize,
            (1000. * scale).round() as usize,
        ],
        export.quality,
    );
    let height = (image.size[1] as f32 / scale).ceil() as u32 + 240;
    let mut svg = report(height);
    text(
        &mut svg,
        80.,
        60.,
        32,
        "start",
        &tr.tr("metrics.report.heatmapTitle", &[]),
    );
    let stops = [0., 0.5, 1.]
        .map(|density| {
            let color = crate::heatmap::density_color(density);
            format!(
                "<stop offset='{density}' stop-color='#{:02x}{:02x}{:02x}'/>",
                color.r(),
                color.g(),
                color.b()
            )
        })
        .join("");
    svg.push_str(&format!("<defs><linearGradient id='heat'>{stops}</linearGradient></defs><rect x='48' y='{}' width='1504' height='22' fill='url(#heat)'/>", height - 100));
    text(
        &mut svg,
        48.,
        (height - 38) as f64,
        24,
        "start",
        &tr.tr("metrics.report.lowDensity", &[]),
    );
    text(
        &mut svg,
        1552.,
        (height - 38) as f64,
        24,
        "end",
        &tr.tr("metrics.report.highDensity", &[]),
    );
    let mut pixmap = rasterize(svg, options, scale)?;
    let width = pixmap.width() as usize;
    let left = (width - image.size[0]) / 2;
    for y in 0..image.size[1] {
        for x in 0..image.size[0] {
            let offset = ((y + (95. * scale).round() as usize) * width + left + x) * 4;
            pixmap.data_mut()[offset..offset + 4]
                .copy_from_slice(&image.pixels[y * image.size[0] + x].to_array());
        }
    }
    Ok(pixmap)
}

/// Seven legacy names, complete chart history, and a freshly calculated heatmap.
/// Default report settings for callers that do not have an export-language draft.
pub fn build_image_zip(
    history: &[Point],
    document: &MapDocument,
    included: usize,
) -> Result<Vec<u8>, String> {
    build_image_zip_with_options(history, document, included, ImageOptions::default())
}

pub fn build_image_zip_with_options(
    history: &[Point],
    document: &MapDocument,
    included: usize,
    export: ImageOptions,
) -> Result<Vec<u8>, String> {
    let mut options = usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    let tr = Translator::new(export.language);
    let scale = export.quality.width() as f32 / WIDTH as f32 * export.quality.samples() as f32;
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options_zip =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let mut add = |name, image: tiny_skia::Pixmap| -> Result<(), String> {
        zip.start_file(name, options_zip)
            .map_err(|e| e.to_string())?;
        zip.write_all(&png(&image, export.quality.samples())?)
            .map_err(|e| e.to_string())
    };
    for (name, metric) in CHARTS {
        add(
            name,
            rasterize(chart(history, metric, &tr), &options, scale)?,
        )?;
    }
    add(
        "resumen.png",
        rasterize(summary(history, document, included, &tr), &options, scale)?,
    )?;
    add(
        "mapa_de_calor.png",
        heatmap(document, &options, scale, export, &tr)?,
    )?;
    Ok(zip.finish().map_err(|e| e.to_string())?.into_inner())
}
