use std::time::Duration;

pub const MAX_STEPS_PER_FRAME: u32 = 8;

/// Fixed-step clock. Keep the fractional remainder, but discard excess debt.
#[derive(Default)]
pub struct SimulationClock {
    accumulator: f64,
}

impl SimulationClock {
    pub fn advance(&mut self, elapsed: Duration, rate: f64, playing: bool) -> u32 {
        if !playing {
            self.accumulator = 0.0;
            return 0;
        }
        let interval = 1.0 / rate;
        self.accumulator += elapsed.as_secs_f64();
        let due = (self.accumulator / interval).floor();
        let steps = due.min(f64::from(MAX_STEPS_PER_FRAME)) as u32;
        self.accumulator -= due * interval;
        steps
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_steps_keep_fractional_time() {
        let mut clock = SimulationClock::default();
        assert_eq!(clock.advance(Duration::from_millis(50), 10.0, true), 0);
        assert_eq!(clock.advance(Duration::from_millis(50), 10.0, true), 1);
        assert_eq!(clock.advance(Duration::from_millis(250), 10.0, true), 2);
        assert_eq!(clock.advance(Duration::from_millis(60), 10.0, true), 1);
    }

    #[test]
    fn slow_frame_is_capped_without_catchup_debt() {
        let mut clock = SimulationClock::default();
        assert_eq!(clock.advance(Duration::from_secs(1), 240.0, true), 8);
        assert_eq!(clock.advance(Duration::ZERO, 240.0, true), 0);
    }

    #[test]
    fn pause_discards_time() {
        let mut clock = SimulationClock::default();
        assert_eq!(clock.advance(Duration::from_millis(90), 10.0, true), 0);
        assert_eq!(clock.advance(Duration::from_secs(5), 10.0, false), 0);
        assert_eq!(clock.advance(Duration::from_millis(20), 10.0, true), 0);
    }
}
