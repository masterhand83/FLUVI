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

/// Fixed-step scheduling and completed-tick sampling share the simulation side.
pub struct TickControl {
    clock: SimulationClock,
    step_ticket: u64,
    playing: bool,
    sample_elapsed: Duration,
    sample_ticks: u64,
}

impl Default for TickControl {
    fn default() -> Self {
        Self {
            clock: SimulationClock::default(),
            step_ticket: 0,
            playing: true,
            sample_elapsed: Duration::ZERO,
            sample_ticks: 0,
        }
    }
}

impl TickControl {
    pub fn reset(&mut self, step_ticket: u64, playing: bool) {
        *self = Self {
            step_ticket,
            playing,
            ..Self::default()
        };
    }
    pub fn advance(
        &mut self,
        elapsed: Duration,
        rate: f64,
        playing: bool,
        step_ticket: u64,
    ) -> u32 {
        let changed = self.playing != playing;
        self.playing = playing;
        if !playing || changed || self.sample_elapsed >= Duration::from_millis(500) {
            self.sample_elapsed = Duration::ZERO;
            self.sample_ticks = 0;
        }
        // The first frame after Play must not charge time spent paused.
        let elapsed = if changed { Duration::ZERO } else { elapsed };
        if playing {
            self.sample_elapsed += elapsed;
        }
        let steps = self.clock.advance(elapsed, rate, playing);
        let manual = step_ticket
            .saturating_sub(self.step_ticket)
            .min(u64::from(u32::MAX)) as u32;
        self.step_ticket = step_ticket;
        if playing { steps } else { manual }
    }

    pub fn completed(&mut self, ticks: u32) {
        if self.playing {
            self.sample_ticks += u64::from(ticks);
        }
    }

    pub fn fps(&self) -> f64 {
        if self.sample_elapsed.is_zero() {
            0.0
        } else {
            self.sample_ticks as f64 / self.sample_elapsed.as_secs_f64()
        }
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

    #[test]
    fn controls_step_once_and_reset_fps_on_pause() {
        let mut ticks = TickControl::default();
        assert_eq!(ticks.advance(Duration::from_millis(100), 10.0, true, 0), 1);
        ticks.completed(1);
        assert_eq!(ticks.fps(), 10.0);
        assert_eq!(ticks.advance(Duration::from_secs(5), 10.0, false, 0), 0);
        assert_eq!(ticks.fps(), 0.0);
        assert_eq!(ticks.advance(Duration::ZERO, 10.0, false, 1), 1);
        ticks.completed(1);
        assert_eq!(ticks.advance(Duration::from_secs(1), 10.0, false, 1), 0);
        assert_eq!(ticks.fps(), 0.0);
    }

    #[test]
    fn speed_changes_interval_and_frames_do_not_count_as_ticks() {
        let mut ticks = TickControl::default();
        assert_eq!(ticks.advance(Duration::from_millis(50), 10.0, true, 0), 0);
        assert_eq!(ticks.fps(), 0.0);
        assert_eq!(ticks.advance(Duration::from_millis(50), 20.0, true, 0), 2);
        assert_eq!(ticks.fps(), 0.0);
        ticks.completed(2);
        assert_eq!(ticks.fps(), 20.0);
        for _ in 0..10 {
            ticks.advance(Duration::ZERO, 20.0, true, 0);
        }
        assert_eq!(ticks.fps(), 20.0);
    }
}
