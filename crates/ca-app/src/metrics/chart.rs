//! Labelled live charts. Rendering never changes the measured samples.
use super::{Metric, Point, Shell, egui};

impl Metric {
    fn colour(self, dark: bool) -> egui::Color32 {
        // Separate hues, with lighter variants for the dark map-control theme.
        let rgb = match (self, dark) {
            (Self::Density, false) => [0, 114, 178],
            (Self::Density, true) => [86, 180, 233],
            (Self::NetChange, false) => [166, 105, 0],
            (Self::NetChange, true) => [230, 159, 0],
            (Self::Speed, false) => [0, 128, 91],
            (Self::Speed, true) => [0, 200, 145],
            (Self::Throughput, false) => [155, 75, 135],
            (Self::Throughput, true) => [204, 121, 167],
            (Self::Entropy, false) => [190, 75, 0],
            (Self::Entropy, true) => [255, 130, 65],
        };
        egui::Color32::from_rgb(rgb[0], rgb[1], rgb[2])
    }

    fn axis_key(self) -> &'static str {
        match self {
            Self::Density | Self::Speed => "metrics.axis.percentage",
            Self::NetChange | Self::Throughput => "metrics.axis.rate",
            Self::Entropy => "metrics.axis.entropy",
        }
    }

    fn range(self, points: &[Point]) -> (f64, f64) {
        let first = points.first().map_or(0., |&point| self.value(point));
        let (minimum, maximum) =
            points
                .iter()
                .fold((first, first), |(minimum, maximum), &point| {
                    let value = self.value(point);
                    (minimum.min(value), maximum.max(value))
                });
        // Use the visible data, not a fixed theoretical maximum or forced zero.
        // Leave 10% on both sides, including flat and all-zero histories.
        let resolution = if matches!(self, Self::Entropy) {
            0.001
        } else {
            0.01
        };
        let padding = if maximum > minimum {
            (maximum - minimum) * 0.1
        } else {
            (first.abs() * 0.1).max(resolution * 0.1)
        };
        (minimum - padding, maximum + padding)
    }

    fn tick_label(self, value: f64) -> String {
        // Padding can add one decimal place beyond the recorded precision.
        let precision = if matches!(self, Self::Entropy) { 4 } else { 3 };
        let value = if value.abs() < 0.5 * 10_f64.powi(-(precision as i32)) {
            0.
        } else {
            value
        };
        let label = format!("{value:.precision$}");
        let trimmed = label.trim_end_matches('0');
        if trimmed.ends_with('.') {
            format!("{trimmed}0")
        } else {
            trimmed.to_owned()
        }
    }
}

pub(super) fn show(ui: &mut egui::Ui, points: &[Point], metric: Metric, shell: &Shell) {
    let colour = metric.colour(ui.visuals().dark_mode);
    ui.colored_label(
        colour,
        egui::RichText::new(shell.tr(metric.key(), &[])).strong(),
    );
    if let Some(&latest) = points.last() {
        ui.label(shell.tr(
            "metrics.latestValue",
            &[("value", &metric.formatted(latest))],
        ));
    }
    ui.small(shell.tr(metric.axis_key(), &[]));
    let (rect, response) =
        ui.allocate_exact_size(egui::vec2(ui.available_width(), 144.), egui::Sense::hover());
    let painter = ui.painter();
    let text = ui.visuals().text_color();
    let axis = egui::Stroke::new(1_f32, ui.visuals().weak_text_color());
    let grid = egui::Stroke::new(1_f32, ui.visuals().widgets.noninteractive.bg_stroke.color);
    let font = egui::FontId::proportional(10.);
    let (minimum, maximum) = metric.range(points);
    let tick_labels =
        [minimum, (minimum + maximum) * 0.5, maximum].map(|value| metric.tick_label(value));
    let label_width = tick_labels
        .iter()
        .map(|label| {
            painter
                .layout_no_wrap(label.clone(), font.clone(), text)
                .size()
                .x
        })
        .fold(36_f32, f32::max);
    let plot = egui::Rect::from_min_max(
        rect.min + egui::vec2(label_width + 8., 8.),
        rect.max - egui::vec2(8., 44.),
    );
    let position = |index: usize, point: Point| {
        let fraction = if points.len() <= 1 {
            0.5
        } else {
            index as f32 / (points.len() - 1) as f32
        };
        egui::pos2(
            plot.left() + fraction * plot.width(),
            plot.bottom()
                - ((metric.value(point) - minimum) / (maximum - minimum)) as f32 * plot.height(),
        )
    };
    painter.rect_filled(plot, 0., ui.visuals().extreme_bg_color);
    for (fraction, label) in [0., 0.5, 1.].into_iter().zip(tick_labels) {
        let y = plot.bottom() - fraction as f32 * plot.height();
        painter.line_segment(
            [egui::pos2(plot.left(), y), egui::pos2(plot.right(), y)],
            grid,
        );
        painter.text(
            egui::pos2(plot.left() - 6., y),
            egui::Align2::RIGHT_CENTER,
            label,
            font.clone(),
            text,
        );
    }
    painter.line_segment([plot.left_top(), plot.left_bottom()], axis);
    painter.line_segment([plot.left_bottom(), plot.right_bottom()], axis);
    painter.text(
        egui::pos2(plot.center().x, rect.bottom() - 2.),
        egui::Align2::CENTER_BOTTOM,
        shell.tr("metrics.axis.time", &[]),
        font.clone(),
        text,
    );
    if points.is_empty() {
        return;
    }
    let ticks = if points.len() == 1 {
        1
    } else if plot.width() < 220. {
        2
    } else {
        3
    };
    for tick in 0..ticks {
        let index = if ticks == 1 {
            0
        } else {
            tick * (points.len() - 1) / (ticks - 1)
        };
        let x = position(index, points[index]).x;
        painter.line_segment(
            [
                egui::pos2(x, plot.bottom()),
                egui::pos2(x, plot.bottom() + 4.),
            ],
            axis,
        );
        let align = if ticks == 1 {
            egui::Align2::CENTER_TOP
        } else if tick == 0 {
            egui::Align2::LEFT_TOP
        } else if tick == ticks - 1 {
            egui::Align2::RIGHT_TOP
        } else {
            egui::Align2::CENTER_TOP
        };
        painter.text(
            egui::pos2(x, plot.bottom() + 6.),
            align,
            points[index].clock.numeric(),
            font.clone(),
            text,
        );
    }
    let path: Vec<_> = points
        .iter()
        .enumerate()
        .map(|(i, &p)| position(i, p))
        .collect();
    if path.len() == 1 {
        painter.circle_filled(path[0], 3., colour);
    } else {
        painter.add(egui::Shape::line(path, egui::Stroke::new(2_f32, colour)));
    }
    if let Some(pointer) = response.hover_pos() {
        let index = (((pointer.x - plot.left()) / plot.width()).clamp(0., 1.)
            * points.len().saturating_sub(1) as f32)
            .round() as usize;
        let point = points[index];
        let marker = position(index, point);
        painter.line_segment(
            [
                egui::pos2(marker.x, plot.top()),
                egui::pos2(marker.x, plot.bottom()),
            ],
            egui::Stroke::new(1_f32, colour),
        );
        painter.circle_filled(marker, 4., colour);
        ui.label(
            egui::RichText::new(format!(
                "{} · {}",
                point.clock.numeric(),
                metric.formatted(point)
            ))
            .color(colour),
        );
        response.show_tooltip_ui(|ui| {
            for line in metric.tooltip(point, shell.translator()) {
                ui.label(line);
            }
        });
    } else {
        ui.label(egui::RichText::new(shell.tr("metrics.hoverHint", &[])).weak());
    }
}
