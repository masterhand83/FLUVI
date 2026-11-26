//! Tick-based traffic estimates. Calendar time labels points, never rate intervals.
use crate::{
    traffic::{Calle, LaneDirection},
    virtual_time::{Clock, SECONDS_PER_TICK},
};

pub const LIVE_POINTS: usize = 50;
pub const ENTROPY_INTERVAL: u64 = 60;

/// Numeric equivalent of v1's `Number(value.toFixed(...))` for finite estimates.
/// Scale the exact binary fraction with integers: multiplying the f64 by the
/// decimal scale first can turn a value just below a tie into an exact tie.
fn fixed_decimal(value: f64, scale: u64) -> f64 {
    let bits = value.abs().to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32 - 1023 - 52;
    if exponent >= 0 {
        return value; // Already an integer.
    }
    let shift = (-exponent) as u32;
    if shift >= 128 {
        return 0.;
    }
    let mantissa = (bits & ((1_u64 << 52) - 1)) | (1_u64 << 52);
    let numerator = u128::from(mantissa) * u128::from(scale);
    let denominator = 1_u128 << shift;
    let rounded = numerator / denominator + u128::from(numerator % denominator >= denominator / 2);
    (rounded as f64 / scale as f64).copysign(value)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub clock: Clock,
    pub elapsed_seconds: u64,
    pub density: f64,
    pub net_change: f64,
    pub speed: f64,
    pub throughput: f64,
    pub entropy: f64,
    pub population: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Collapse,
    Optimal,
    Congested,
    Underused,
    Moderate,
}

impl Status {
    pub fn key(self) -> &'static str {
        match self {
            Self::Collapse => "metrics.collapse",
            Self::Optimal => "metrics.optimal",
            Self::Congested => "metrics.congested",
            Self::Underused => "metrics.underused",
            Self::Moderate => "metrics.moderate",
        }
    }
    pub fn observation_key(self) -> &'static str {
        match self {
            Self::Collapse => "metrics.observation.collapse",
            Self::Optimal => "metrics.observation.optimal",
            Self::Congested => "metrics.observation.congested",
            Self::Underused => "metrics.observation.underused",
            Self::Moderate => "metrics.observation.moderate",
        }
    }
}

impl Point {
    pub fn status(self) -> Status {
        if self.density > 80. && self.speed < 15. {
            Status::Collapse
        } else if (25. ..=60.).contains(&self.density) && self.speed >= 50. {
            Status::Optimal
        } else if self.density > 60. && self.speed < 35. {
            Status::Congested
        } else if self.density < 25. {
            Status::Underused
        } else {
            Status::Moderate
        }
    }
}

#[derive(Default)]
pub struct Metrics {
    included: Vec<bool>,
    previous_sample: Vec<Vec<u8>>,
    sampled: bool,
    entropy: f64,
    ticks: u64,
    previous_population: Option<usize>,
    history: Vec<Point>,
}

impl Metrics {
    pub fn new(streets: &[Calle]) -> Self {
        Self {
            included: vec![true; streets.len()],
            previous_sample: streets.iter().map(|s| vec![0; s.cells().len()]).collect(),
            ..Default::default()
        }
    }

    pub fn history(&self) -> &[Point] {
        &self.history
    }

    pub fn live(&self) -> &[Point] {
        &self.history[self.history.len().saturating_sub(LIVE_POINTS)..]
    }

    pub fn included(&self) -> &[bool] {
        &self.included
    }

    pub fn set_included(&mut self, streets: &[Calle], included: Vec<bool>) {
        assert_eq!(streets.len(), included.len());
        if self.included != included {
            self.included = included;
            self.previous_population = None;
            self.invalidate_sample(streets);
        }
    }

    fn invalidate_sample(&mut self, streets: &[Calle]) {
        self.previous_sample = streets.iter().map(|s| vec![0; s.cells().len()]).collect();
        self.sampled = false;
        self.entropy = 0.;
    }

    /// Keep history and surviving physical street selections across topology edits.
    pub fn reconcile(&mut self, streets: &[Calle], deleted: Option<usize>) {
        let changed_region = deleted.is_some_and(|id| self.included.remove(id));
        let added = streets.len() > self.included.len();
        let dimensions_changed = self.previous_sample.len() != streets.len()
            || self
                .previous_sample
                .iter()
                .zip(streets)
                .any(|(sample, street)| sample.len() != street.cells().len());
        self.included.resize(streets.len(), true);
        if changed_region || added {
            self.previous_population = None;
        }
        if deleted.is_some() || added || dimensions_changed {
            self.invalidate_sample(streets);
        }
    }

    pub fn reset(&mut self) {
        self.ticks = 0;
        self.previous_population = None;
        self.history.clear();
        self.sampled = false;
        self.entropy = 0.;
    }

    pub fn update(&mut self, streets: &[Calle], clock: Clock) {
        let sample = self.ticks.is_multiple_of(ENTROPY_INTERVAL);
        self.ticks += 1;
        let mut population = 0;
        let mut cells = 0;
        let mut moving = 0;
        let mut transitions = [0usize; 8];
        for (id, street) in streets.iter().enumerate() {
            if !self.included[id] {
                continue;
            }
            let length = street.config().tamano;
            cells += street.cells().len();
            for (lane, values) in street.cells().chunks_exact(length).enumerate() {
                let reverse = street.lane_direction(lane) == LaneDirection::Reverse;
                let previous = &self.previous_sample[id][lane * length..(lane + 1) * length];
                for (index, &value) in values.iter().enumerate() {
                    let left = (index + length - 1) % length;
                    let right = (index + 1) % length;
                    if (1..=6).contains(&value) {
                        population += 1;
                        moving += usize::from(values[if reverse { left } else { right }] == 0);
                    }
                    if sample && self.sampled {
                        // v1 entropy uses nonzero occupancy, including obstruction 7.
                        let (behind, ahead) = if reverse {
                            (right, left)
                        } else {
                            (left, right)
                        };
                        let rule = (usize::from(previous[behind] > 0) << 2)
                            | (usize::from(previous[index] > 0) << 1)
                            | usize::from(previous[ahead] > 0);
                        transitions[rule] += 1;
                    }
                }
            }
            if sample {
                self.previous_sample[id].copy_from_slice(street.cells());
            }
        }
        if sample {
            self.entropy = if cells == 0 {
                0.
            } else {
                transitions
                    .iter()
                    .filter(|&&n| n > 0)
                    .map(|&n| {
                        let p = n as f64 / cells as f64;
                        -p * p.log2()
                    })
                    .sum()
            };
            self.sampled = true;
        }
        let density = if cells == 0 {
            0.
        } else {
            population as f64 / cells as f64
        };
        let speed = if population == 0 {
            0.
        } else {
            moving as f64 / population as f64
        };
        let net_change = self.previous_population.map_or(0., |previous| {
            (population as f64 - previous as f64) / f64::from(SECONDS_PER_TICK)
        });
        self.previous_population = Some(population);
        // v1 publishes fixed-decimal values. Keep charts, status thresholds, and
        // export history on those same numbers, not unrounded intermediates.
        self.history.push(Point {
            clock,
            elapsed_seconds: self.ticks * u64::from(SECONDS_PER_TICK),
            density: fixed_decimal(density * 100., 100),
            net_change: fixed_decimal(net_change, 100),
            speed: fixed_decimal(speed * 100., 100),
            throughput: fixed_decimal(density * (speed * 100. / 100.) * 10., 100),
            entropy: fixed_decimal(self.entropy, 1000),
            population,
        });
    }
}
