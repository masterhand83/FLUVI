//! Manual ticket-34 CPU gate. Timings are measurements, not CI assertions.
use std::{hint::black_box, time::Instant};

use ca_core::{
    map_json::MapDocument,
    traffic::{Calle, CalleConfig, CalleType, LaneDirection, TickPhase, TrafficModel},
};

fn network(count: usize, lane_changes: bool) -> TrafficModel {
    let streets = (0..count)
        .map(|_| {
            let mut config = CalleConfig::new(2, 250, CalleType::Generador);
            config.generation_probability = 0.35;
            config.lane_change_probability = if lane_changes { 0.1 } else { 0.0 };
            config.lane_directions =
                vec![Some(LaneDirection::Forward), Some(LaneDirection::Reverse)];
            Calle::new(config, vec![0; 500]).unwrap()
        })
        .collect();
    TrafficModel::new(streets, 42)
}

fn percentile(samples: &mut [f64], fraction: f64) -> f64 {
    samples.sort_unstable_by(f64::total_cmp);
    samples[((samples.len() - 1) as f64 * fraction).round() as usize]
}

fn measure(name: &str, mut model: TrafficModel) {
    model.random_fill(0.5).unwrap();
    let initial = model.clone();
    let cells: usize = model.streets().iter().map(|s| s.cells().len()).sum();
    let mut ticks = Vec::with_capacity(600);
    let mut updates = Vec::with_capacity(600);
    let mut changes = Vec::with_capacity(600);
    // Restart each block to retain dense traffic instead of timing an empty map.
    for block in 0..7 {
        model.clone_from(&initial);
        for _ in 0..100 {
            let start = Instant::now();
            let mut previous = start;
            let mut update = 0.0;
            let mut change = 0.0;
            model.tick_with_hook(|phase, streets| {
                black_box(streets);
                let now = Instant::now();
                let elapsed = (now - previous).as_secs_f64() * 1000.0;
                if phase == TickPhase::StreetUpdate {
                    update = elapsed;
                }
                if phase == TickPhase::LaneChanges {
                    change = elapsed;
                }
                previous = now;
            });
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            if block != 0 {
                ticks.push(elapsed);
                updates.push(update);
                changes.push(change);
            }
        }
    }
    println!(
        "{name}: {cells} cells; tick median/p95 {:.3}/{:.3} ms; street update {:.3}/{:.3} ms; lane changes {:.3}/{:.3} ms",
        percentile(&mut ticks, 0.5),
        percentile(&mut ticks, 0.95),
        percentile(&mut updates, 0.5),
        percentile(&mut updates, 0.95),
        percentile(&mut changes, 0.5),
        percentile(&mut changes, 0.95),
    );
    black_box(model);
}

fn main() {
    measure("campus", MapDocument::campus().model().clone());
    measure("large", network(128, false));
    measure("cell limit", network(2000, false));
    measure("cell limit + lane changes", network(2000, true));
}
