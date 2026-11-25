//! Bounded statistical analysis worker.
use std::{collections::VecDeque, thread};

use ca_core::PopulationSample;
use crossbeam_channel::{Receiver, Sender, bounded};
use polars::prelude::*;

pub const WINDOW_GENERATIONS: u64 = 64;
const CHANNEL_CAPACITY: usize = 256;

#[derive(Debug, thiserror::Error)]
pub enum AnalysisError {
    #[error("Polars analysis failed: {0}")]
    Polars(#[from] PolarsError),
    #[error("cannot start analysis worker: {0}")]
    Spawn(#[from] std::io::Error),
}

#[derive(Clone, Copy, Debug)]
pub struct Statistics {
    pub sample: PopulationSample,
    pub observations: usize,
    pub mean: Option<f64>,
    /// Sample standard deviation (ddof = 1); undefined for one observation.
    pub std: Option<f64>,
}

/// Own input and output separately so dropping input always terminates the worker.
pub struct Worker {
    pub input: Sender<PopulationSample>,
    pub output: Receiver<Statistics>,
    pub join: thread::JoinHandle<Result<(), AnalysisError>>,
}

pub fn spawn_worker() -> Result<Worker, AnalysisError> {
    let (input, rx) = bounded(CHANNEL_CAPACITY);
    let (tx, output) = bounded(CHANNEL_CAPACITY);
    let join = thread::Builder::new()
        .name("ca-analysis".into())
        .spawn(move || {
            let mut history = History::default();
            for sample in rx {
                if let Some(result) = history.push(sample)? {
                    // A slow/closed consumer must not prevent shutdown.
                    let _ = tx.try_send(result);
                }
            }
            Ok(())
        })?;
    Ok(Worker {
        input,
        output,
        join,
    })
}

#[derive(Default)]
struct History {
    samples: VecDeque<PopulationSample>,
}

impl History {
    fn push(&mut self, sample: PopulationSample) -> Result<Option<Statistics>, AnalysisError> {
        if let Some(last) = self.samples.back() {
            if sample.epoch < last.epoch
                || (sample.epoch == last.epoch && sample.generation < last.generation)
            {
                return Ok(None);
            }
            if sample.epoch != last.epoch {
                self.samples.clear();
            } else if sample.generation == last.generation {
                // Painting while paused updates this generation, not its weight.
                self.samples.pop_back();
            }
        }
        let first = sample.generation.saturating_sub(WINDOW_GENERATIONS - 1);
        self.samples.retain(|s| s.generation >= first);
        self.samples.push_back(sample);
        let values: Vec<f64> = self
            .samples
            .iter()
            .map(|s| f64::from(s.population))
            .collect();
        let result = rolling(&values)?;
        Ok(Some(Statistics {
            sample,
            observations: values.len(),
            mean: result.0,
            std: result.1,
        }))
    }
}

fn rolling(values: &[f64]) -> Result<(Option<f64>, Option<f64>), AnalysisError> {
    let mean_options = RollingOptionsFixedWindow {
        window_size: WINDOW_GENERATIONS as usize,
        min_periods: 1,
        ..Default::default()
    };
    let std_options = RollingOptionsFixedWindow {
        min_periods: 2,
        fn_params: Some(RollingFnParams::Var(RollingVarParams { ddof: 1 })),
        ..mean_options.clone()
    };
    let frame = DataFrame::new(
        values.len(),
        vec![Series::new("population".into(), values).into()],
    )?
    .lazy()
    .select([
        col("population").rolling_mean(mean_options).alias("mean"),
        col("population").rolling_std(std_options).alias("std"),
    ])
    .collect()?;
    let last = values.len().saturating_sub(1);
    Ok((
        frame.column("mean")?.f64()?.get(last),
        frame.column("std")?.f64()?.get(last),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(generation: u64, population: u32) -> PopulationSample {
        PopulationSample {
            epoch: 0,
            generation,
            population,
        }
    }
    #[test]
    fn rolling_matches_hand_calculation() {
        let mut history = History::default();
        let mut result = None;
        for n in 1..=128 {
            result = history.push(sample(n, n as u32)).unwrap();
        }
        let result = result.unwrap();
        // Last 64 values are 65..=128: mean 96.5, sample variance 64*65/12.
        assert_eq!(result.observations, 64);
        assert!((result.mean.unwrap() - 96.5).abs() < 1e-10);
        assert!((result.std.unwrap() - (64.0_f64 * 65.0 / 12.0).sqrt()).abs() < 1e-10);
    }
    #[test]
    fn sparse_generations_and_epochs_do_not_mix() {
        let mut history = History::default();
        assert!(history.push(sample(0, 100)).unwrap().unwrap().std.is_none());
        history.push(sample(10, 20)).unwrap();
        let result = history.push(sample(64, 40)).unwrap().unwrap();
        assert_eq!(result.observations, 2);
        assert_eq!(result.mean, Some(30.0));
        assert!((result.std.unwrap() - 200.0_f64.sqrt()).abs() < 1e-10);
        let result = history
            .push(PopulationSample {
                epoch: 1,
                generation: 0,
                population: 7,
            })
            .unwrap()
            .unwrap();
        assert_eq!(result.mean, Some(7.0));
        assert!(history.push(sample(100, 100)).unwrap().is_none());
        let result = history
            .push(PopulationSample {
                epoch: 1,
                generation: 0,
                population: 9,
            })
            .unwrap()
            .unwrap();
        assert_eq!(result.observations, 1);
        assert_eq!(result.mean, Some(9.0));
    }
    #[test]
    fn worker_shuts_down_when_input_drops() {
        let Worker {
            input,
            output,
            join,
        } = spawn_worker().unwrap();
        input.send(sample(1, 10)).unwrap();
        drop(input);
        assert_eq!(
            output
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap()
                .mean,
            Some(10.0)
        );
        join.join().unwrap().unwrap();
        assert!(output.recv().is_err());
    }
}
