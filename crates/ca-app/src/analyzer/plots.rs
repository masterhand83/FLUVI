use super::Plot;
use crate::shell::Translator;
use ca_analysis::Report;
use resvg::{tiny_skia, usvg};

const COLORS: [&str; 5] = ["#0d6efd", "#d39e00", "#198754", "#fd7e14", "#dc3545"];
const METRICS: [(usize, &str, &str); 3] = [
    (0, "analyzer.density", "#2879b6"),
    (1, "analyzer.flow", "#d77a12"),
    (3, "analyzer.speed", "#198754"),
];

fn text(svg: &mut String, x: f64, y: f64, size: usize, anchor: &str, content: &str) {
    let content = content
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    svg.push_str(&format!("<text x='{x}' y='{y}' font-family='sans-serif' font-size='{size}' text-anchor='{anchor}' fill='#172033'>{content}</text>"));
}
fn line(svg: &mut String, x: f64, y: f64, x2: f64, y2: f64, color: &str) {
    svg.push_str(&format!(
        "<path d='M{x} {y} L{x2} {y2}' stroke='{color}' fill='none'/>"
    ));
}
fn circle(svg: &mut String, x: f64, y: f64, color: &str) {
    svg.push_str(&format!(
        "<circle cx='{x:.3}' cy='{y:.3}' r='2.5' fill='{color}'/>"
    ));
}
fn range(values: impl Iterator<Item = f64>) -> [f64; 2] {
    let (mut min, mut max) = (0_f64, 0_f64);
    for v in values {
        min = min.min(v);
        max = max.max(v);
    }
    if min == max {
        max = min + 1.;
    }
    [min, max]
}
struct Axes {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    xr: [f64; 2],
    yr: [f64; 2],
}
impl Axes {
    fn point(&self, x: f64, y: f64) -> (f64, f64) {
        (
            self.x + (x - self.xr[0]) / (self.xr[1] - self.xr[0]) * self.w,
            self.y + self.h - (y - self.yr[0]) / (self.yr[1] - self.yr[0]) * self.h,
        )
    }
    fn draw(&self, svg: &mut String, title: &str, xlabel: &str, ylabel: &str) {
        text(svg, self.x + self.w / 2., self.y - 42., 21, "middle", title);
        text(svg, self.x, self.y - 15., 16, "start", ylabel);
        for i in 0..=4 {
            let value = self.yr[0] + (self.yr[1] - self.yr[0]) * i as f64 / 4.;
            let (_, y) = self.point(self.xr[0], value);
            line(svg, self.x, y, self.x + self.w, y, "#dce2ea");
            text(svg, self.x - 8., y + 5., 14, "end", &format!("{value:.3}"));
            let value = self.xr[0] + (self.xr[1] - self.xr[0]) * i as f64 / 4.;
            let (x, _) = self.point(value, self.yr[0]);
            text(
                svg,
                x,
                self.y + self.h + 23.,
                14,
                "middle",
                &format!("{value:.2}"),
            );
        }
        line(svg, self.x, self.y, self.x, self.y + self.h, "#64748b");
        line(
            svg,
            self.x,
            self.y + self.h,
            self.x + self.w,
            self.y + self.h,
            "#64748b",
        );
        text(
            svg,
            self.x + self.w / 2.,
            self.y + self.h + 50.,
            18,
            "middle",
            xlabel,
        );
    }
}
fn start(height: usize, key: &str, tr: &Translator) -> String {
    let mut svg = format!(
        "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='{height}'><rect width='100%' height='100%' fill='white'/>"
    );
    text(&mut svg, 800., 45., 30, "middle", &tr.tr(key, &[]));
    svg
}
fn temporal(report: &Report, tr: &Translator) -> String {
    let mut svg = start(1000, "analyzer.temporal", tr);
    let first = report.samples.first().unwrap().accumulated / 60.;
    let last = report.samples.last().unwrap().accumulated / 60.;
    let xr = [first, if last == first { first + 1. } else { last }];
    for (panel, (metric, key, color)) in METRICS
        .into_iter()
        .chain(std::iter::once((0, "analyzer.states", COLORS[0])))
        .enumerate()
    {
        let axes = Axes {
            x: 110. + (panel % 2) as f64 * 790.,
            y: 150. + (panel / 2) as f64 * 425.,
            w: 630.,
            h: 290.,
            xr,
            yr: range(report.samples.iter().map(|s| s.values[metric])),
        };
        axes.draw(
            &mut svg,
            &tr.tr(key, &[]),
            &tr.tr("analyzer.time", &[]),
            &tr.tr(if panel == 3 { "analyzer.density" } else { key }, &[]),
        );
        if panel == 3 {
            for sample in &report.samples {
                let (x, y) = axes.point(sample.accumulated / 60., sample.values[0]);
                circle(&mut svg, x, y, COLORS[sample.state()]);
            }
        } else {
            let mut path = String::new();
            for (i, sample) in report.samples.iter().enumerate() {
                let (x, y) = axes.point(sample.accumulated / 60., sample.values[metric]);
                path.push_str(&format!(
                    "{} {x:.3} {y:.3} ",
                    if i == 0 { "M" } else { "L" }
                ));
            }
            svg.push_str(&format!(
                "<path d='{path}' stroke='{color}' stroke-width='1.2' fill='none'/>"
            ));
            if report.samples.len() == 1 {
                let (x, y) = axes.point(first, report.samples[0].values[metric]);
                circle(&mut svg, x, y, color);
            }
        }
    }
    for (i, state) in ["underused", "moderate", "optimal", "congested", "collapse"]
        .iter()
        .enumerate()
    {
        let x = 160. + i as f64 * 295.;
        circle(&mut svg, x, 971., COLORS[i]);
        text(
            &mut svg,
            x + 10.,
            977.,
            17,
            "start",
            &tr.tr(&format!("analyzer.{state}"), &[]),
        );
    }
    svg
}
fn heat_color(ratio: f64) -> String {
    let t = ratio.clamp(0., 1.);
    format!(
        "#{:02x}{:02x}{:02x}",
        255 - (70. * t) as u8,
        245 - (220. * t) as u8,
        190 - (165. * t) as u8
    )
}
fn fundamental(report: &Report, tr: &Translator) -> String {
    let mut svg = start(750, "analyzer.fundamental", tr);
    let axes = Axes {
        x: 95.,
        y: 165.,
        w: 380.,
        h: 430.,
        xr: range(report.samples.iter().map(|s| s.values[0])),
        yr: range(report.samples.iter().map(|s| s.values[4])),
    };
    axes.draw(
        &mut svg,
        &tr.tr("analyzer.entropyDensity", &[]),
        &tr.tr("analyzer.density", &[]),
        &tr.tr("analyzer.entropy", &[]),
    );
    let flow_range = range(report.samples.iter().map(|s| s.values[1]));
    for sample in &report.samples {
        let (x, y) = axes.point(sample.values[0], sample.values[4]);
        circle(
            &mut svg,
            x,
            y,
            &heat_color((sample.values[1] - flow_range[0]) / (flow_range[1] - flow_range[0])),
        );
    }
    text(
        &mut svg,
        280.,
        690.,
        16,
        "middle",
        &format!(
            "{}: {:.3} – {:.3}",
            tr.tr("analyzer.flow", &[]),
            flow_range[0],
            flow_range[1]
        ),
    );
    let cells = &report.plot_data.heatmap;
    let mut days: Vec<_> = cells.iter().map(|c| c.weekday).collect();
    days.sort_unstable();
    days.dedup();
    let mut hours: Vec<_> = cells.iter().map(|c| c.hour).collect();
    hours.sort_unstable();
    hours.dedup();
    let maximum = cells
        .iter()
        .map(|cell| cell.density)
        .fold(0_f64, f64::max)
        .max(f64::EPSILON);
    for (panel, scale) in [100., maximum].into_iter().enumerate() {
        let left = 655. + panel as f64 * 510.;
        let width = 365.;
        let height = 430.;
        let title = if panel == 0 {
            "analyzer.fixedHeatmap"
        } else {
            "analyzer.dynamicHeatmap"
        };
        text(
            &mut svg,
            left + width / 2.,
            120.,
            18,
            "middle",
            &tr.tr(title, &[]),
        );
        for (row, &day) in days.iter().enumerate() {
            let h = height / days.len() as f64;
            let day_key = [
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
            ][day];
            text(
                &mut svg,
                left - 10.,
                165. + (row as f64 + 0.5) * h,
                14,
                "end",
                &tr.tr(&format!("clock.{day_key}"), &[]),
            );
            for (col, &hour) in hours.iter().enumerate() {
                let w = width / hours.len() as f64;
                let x = left + col as f64 * w;
                if let Some(cell) = cells
                    .iter()
                    .find(|cell| cell.weekday == day && cell.hour == hour)
                {
                    svg.push_str(&format!(
                        "<rect x='{x}' y='{}' width='{w}' height='{h}' fill='{}' stroke='white'/>",
                        165. + row as f64 * h,
                        heat_color(cell.density / scale)
                    ));
                }
                if row == 0 {
                    text(&mut svg, x + w / 2., 620., 14, "middle", &hour.to_string());
                }
            }
        }
        text(
            &mut svg,
            left + width / 2.,
            650.,
            18,
            "middle",
            &tr.tr("analyzer.hour", &[]),
        );
        for i in 0..100 {
            svg.push_str(&format!(
                "<rect x='{}' y='680' width='{}' height='12' fill='{}'/>",
                left + i as f64 * width / 100.,
                width / 100. + 0.1,
                heat_color(i as f64 / 99.)
            ));
        }
        text(&mut svg, left, 717., 14, "start", "0");
        text(
            &mut svg,
            left + width,
            717.,
            14,
            "end",
            &format!("{scale:.3}%"),
        );
    }
    svg
}
fn distributions(report: &Report, tr: &Translator) -> String {
    let mut svg = start(1000, "analyzer.distributions", tr);
    for (column, &(_, key, color)) in METRICS[..2].iter().enumerate() {
        let distribution = if column == 0 {
            &report.plot_data.density
        } else {
            &report.plot_data.flow
        };
        let [low, high] = distribution.bounds;
        let bins = &distribution.bins;
        let x = 110. + column as f64 * 790.;
        let axes = Axes {
            x,
            y: 150.,
            w: 630.,
            h: 290.,
            xr: [low, high],
            yr: [0., (*bins.iter().max().unwrap()).max(1) as f64],
        };
        axes.draw(
            &mut svg,
            &tr.tr(key, &[]),
            &tr.tr(key, &[]),
            &tr.tr("analyzer.frequency", &[]),
        );
        for (i, count) in bins.iter().enumerate() {
            let (x, y) = axes.point(low + (high - low) * i as f64 / 50., *count as f64);
            svg.push_str(&format!("<rect x='{x}' y='{y}' width='{}' height='{}' fill='{color}' stroke='white' stroke-width='0.5'/>", axes.w / 50., axes.y + axes.h - y));
        }
        let [q1, median, q3] = distribution.box_plot.quartiles;
        let [whisker_low, whisker_high] = distribution.box_plot.whiskers;
        let axes = Axes {
            x,
            y: 590.,
            w: 630.,
            h: 290.,
            xr: [0., 2.],
            yr: [low.min(0.), high.max(0.)],
        };
        axes.draw(
            &mut svg,
            &format!("{} — {}", tr.tr(key, &[]), tr.tr("analyzer.box", &[])),
            &tr.tr(key, &[]),
            &tr.tr(key, &[]),
        );
        let (middle, ylow) = axes.point(1., whisker_low);
        let (_, yhigh) = axes.point(1., whisker_high);
        let (_, yq1) = axes.point(1., q1);
        let (_, yq3) = axes.point(1., q3);
        let (_, ymedian) = axes.point(1., median);
        line(&mut svg, middle, ylow, middle, yhigh, color);
        for y in [ylow, yhigh] {
            line(&mut svg, middle - 50., y, middle + 50., y, color);
        }
        svg.push_str(&format!("<rect x='{}' y='{yq3}' width='180' height='{}' fill='{color}' fill-opacity='0.4' stroke='{color}'/>", middle - 90., yq1 - yq3));
        line(
            &mut svg,
            middle - 90.,
            ymedian,
            middle + 90.,
            ymedian,
            "#172033",
        );
        for &value in &distribution.box_plot.outliers {
            let (_, y) = axes.point(1., value);
            circle(&mut svg, middle, y, color);
        }
    }
    svg
}

pub(super) fn render_reporting(
    report: &Report,
    tr: &Translator,
    mut completed: impl FnMut(usize),
) -> Result<Vec<Plot>, String> {
    let mut options = usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    [
        (
            "analisis_temporal.png",
            "analyzer.temporal",
            temporal as fn(&Report, &Translator) -> String,
        ),
        (
            "diagramas_fundamentales.png",
            "analyzer.fundamental",
            fundamental,
        ),
        (
            "distribuciones_correlaciones.png",
            "analyzer.distributions",
            distributions,
        ),
    ]
    .into_iter()
    .enumerate()
    .map(|(index, (file_name, key, draw))| {
        let mut svg = draw(report, tr);
        svg.push_str("</svg>");
        let tree = usvg::Tree::from_str(&svg, &options).map_err(|_| "analyzer.error.plot")?;
        let mut pixmap = tiny_skia::Pixmap::new(1600, tree.size().height() as u32)
            .ok_or("analyzer.error.plot")?;
        resvg::render(
            &tree,
            tiny_skia::Transform::identity(),
            &mut pixmap.as_mut(),
        );
        let png = pixmap.encode_png().map_err(|_| "analyzer.error.plot")?;
        let image = egui::ColorImage::from_rgba_unmultiplied(
            [1600, pixmap.height() as usize],
            pixmap.data(),
        );
        completed(index + 1);
        Ok(Plot {
            file_name,
            key,
            svg,
            png,
            image,
        })
    })
    .collect()
}
