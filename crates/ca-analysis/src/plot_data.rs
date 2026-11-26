//! Numeric plot aggregates, independent of rendering and display language.
use crate::Sample;
use polars_core::prelude::*;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct BoxPlot {
    /// First quartile, median, third quartile; linear interpolation.
    pub quartiles: [f64; 3],
    /// Extreme observed samples inside the 1.5-IQR fences.
    pub whiskers: [f64; 2],
    pub outliers: Vec<f64>,
}

#[derive(Debug, Clone)]
pub struct Distribution {
    pub bounds: [f64; 2],
    pub bins: [usize; 50],
    pub box_plot: BoxPlot,
}

#[derive(Debug, Clone)]
pub struct HeatCell {
    pub weekday: usize,
    /// Nearest hour, with ties to even; 23:59 rounds to 24, as in v1.
    pub hour: i32,
    pub density: f64,
}

#[derive(Debug, Clone)]
pub struct PlotData {
    pub density: Distribution,
    pub flow: Distribution,
    pub heatmap: Vec<HeatCell>,
}

fn distribution(samples: &[Sample], metric: usize) -> Distribution {
    let mut values: Vec<_> = samples.iter().map(|s| s.values[metric]).collect();
    values.sort_by(f64::total_cmp);
    let (mut low, mut high) = (values[0], *values.last().unwrap());
    if low == high {
        low -= 0.5;
        high += 0.5;
    }
    let mut bins = [0_usize; 50];
    for &value in &values {
        let bin = ((value - low) / (high - low) * 50.) as usize;
        bins[bin.min(49)] += 1;
    }
    let series = Float64Chunked::from_vec("value".into(), values.clone());
    let quartiles =
        [0.25, 0.5, 0.75].map(|q| series.quantile(q, QuantileMethod::Linear).unwrap().unwrap());
    let iqr = quartiles[2] - quartiles[0];
    let lower_fence = quartiles[0] - 1.5 * iqr;
    let upper_fence = quartiles[2] + 1.5 * iqr;
    let whiskers = [
        *values.iter().find(|&&v| v >= lower_fence).unwrap(),
        *values.iter().rev().find(|&&v| v <= upper_fence).unwrap(),
    ];
    let outliers = values
        .into_iter()
        .filter(|v| *v < whiskers[0] || *v > whiskers[1])
        .collect();
    Distribution {
        bounds: [low, high],
        bins,
        box_plot: BoxPlot {
            quartiles,
            whiskers,
            outliers,
        },
    }
}

pub(super) fn build(samples: &[Sample]) -> PlotData {
    let mut cells = BTreeMap::<(usize, i32), (f64, usize)>::new();
    for sample in samples {
        let cell = cells
            .entry((
                sample.weekday,
                (sample.seconds / 3600.).round_ties_even() as i32,
            ))
            .or_default();
        cell.0 += sample.values[0];
        cell.1 += 1;
    }
    let heatmap = cells
        .into_iter()
        .map(|((weekday, hour), (sum, count))| HeatCell {
            weekday,
            hour,
            density: sum / count as f64,
        })
        .collect();
    PlotData {
        density: distribution(samples, 0),
        flow: distribution(samples, 1),
        heatmap,
    }
}
