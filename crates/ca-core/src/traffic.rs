//! Traffic CA for ordinary streets, with physical (not travel-relative) indices.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CalleType {
    Generador,
    Conexion,
    Devorador,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaneDirection {
    Forward,
    Reverse,
}

/// Lane metadata can be shorter than `carriles`. Missing values use v1 defaults.
#[derive(Clone, Debug)]
pub struct CalleConfig {
    pub carriles: usize,
    pub tamano: usize,
    pub tipo: CalleType,
    pub generation_probability: f64,
    pub lane_change_probability: f64,
    pub lane_directions: Vec<Option<LaneDirection>>,
    pub lane_generation_enabled: Vec<Option<bool>>,
}

impl CalleConfig {
    pub fn new(carriles: usize, tamano: usize, tipo: CalleType) -> Self {
        Self {
            carriles,
            tamano,
            tipo,
            generation_probability: 0.0,
            lane_change_probability: 0.0,
            lane_directions: Vec::new(),
            lane_generation_enabled: Vec::new(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TrafficError {
    #[error("street dimensions must be nonzero and their product must fit in usize")]
    Dimensions,
    #[error("cell data must contain carriles * tamano values in 0..=7")]
    Cells,
    #[error("probabilities must be finite and in 0..=1")]
    Probability,
    #[error("lane metadata must not exceed carriles")]
    Lanes,
}

#[derive(Clone, Debug)]
pub struct Calle {
    config: CalleConfig,
    cells: Vec<u8>,
    next: Vec<u8>,
}

impl Calle {
    /// Cells are lane-major, with physical indices `0..tamano` in each lane.
    pub fn new(config: CalleConfig, cells: Vec<u8>) -> Result<Self, TrafficError> {
        let size = config
            .carriles
            .checked_mul(config.tamano)
            .filter(|&size| size > 0)
            .ok_or(TrafficError::Dimensions)?;
        if cells.len() != size || cells.iter().any(|&value| value > 7) {
            return Err(TrafficError::Cells);
        }
        if [
            config.generation_probability,
            config.lane_change_probability,
        ]
        .iter()
        .any(|p| !p.is_finite() || !(0.0..=1.0).contains(p))
        {
            return Err(TrafficError::Probability);
        }
        if config.lane_directions.len() > config.carriles
            || config.lane_generation_enabled.len() > config.carriles
        {
            return Err(TrafficError::Lanes);
        }
        Ok(Self {
            config,
            next: cells.clone(),
            cells,
        })
    }

    pub fn config(&self) -> &CalleConfig {
        &self.config
    }

    pub fn cells(&self) -> &[u8] {
        &self.cells
    }

    /// Panics if `lane` is out of bounds.
    pub fn lane_direction(&self, lane: usize) -> LaneDirection {
        assert!(lane < self.config.carriles);
        self.config
            .lane_directions
            .get(lane)
            .copied()
            .flatten()
            .unwrap_or(LaneDirection::Forward)
    }

    pub fn entry_cell(&self, lane: usize) -> usize {
        match self.lane_direction(lane) {
            LaneDirection::Forward => 0,
            LaneDirection::Reverse => self.config.tamano - 1,
        }
    }

    pub fn exit_cell(&self, lane: usize) -> usize {
        self.config.tamano - 1 - self.entry_cell(lane)
    }

    fn generate(&mut self, random_state: &mut u64) {
        // Hourly multiplier is fixed at 1 until clock/profile support is ported.
        if self.config.tipo != CalleType::Generador {
            return;
        }
        for lane in 0..self.config.carriles {
            if self.config.lane_generation_enabled.get(lane) == Some(&Some(false)) {
                continue;
            }
            let entry = lane * self.config.tamano + self.entry_cell(lane);
            if self.cells[entry] == 0
                && crate::random::unit(random_state) < self.config.generation_probability
            {
                self.cells[entry] = (crate::random::unit(random_state) * 6.0) as u8 + 1;
            }
        }
    }

    /// Snapshot update with open, empty boundaries. No allocations per update.
    pub fn update(&mut self) {
        let size = self.config.tamano;
        self.next.copy_from_slice(&self.cells);
        for lane in 0..self.config.carriles {
            if size > 1 {
                let reverse = self.lane_direction(lane) == LaneDirection::Reverse;
                let start = lane * size;
                for i in 0..size {
                    let left = i.checked_sub(1).map(|p| self.cells[start + p]).unwrap_or(0);
                    let right = if i + 1 < size {
                        self.cells[start + i + 1]
                    } else {
                        0
                    };
                    let center = self.cells[start + i];
                    let (upstream, downstream) = if reverse {
                        (right, left)
                    } else {
                        (left, right)
                    };
                    self.next[start + i] = match rule(upstream, center, downstream) {
                        Some(result) if result > 0 && center > 0 => center,
                        Some(result) => result,
                        None => center,
                    };
                }
            }
            if self.config.tipo == CalleType::Devorador {
                let exit = lane * size + self.exit_cell(lane);
                if (1..=6).contains(&self.next[exit]) {
                    self.next[exit] = 0;
                }
            }
        }
        std::mem::swap(&mut self.cells, &mut self.next);
    }
}

/// Raw v1 table lookup. Missing neighborhoods are not rules with result zero.
pub fn rule(upstream: u8, center: u8, downstream: u8) -> Option<u8> {
    if upstream > 7 || center > 7 || downstream > 7 {
        return None;
    }
    crate::traffic_rules::RULES
        [usize::from(upstream) * 64 + usize::from(center) * 8 + usize::from(downstream)]
}

/// Hooks run after each phase. Only Generation and StreetUpdate do work for now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TickPhase {
    Generation,
    ConnectionTransfers,
    LaneChanges,
    StreetUpdate,
    Rain,
    Clock,
    Metrics,
}

#[derive(Clone, Debug)]
pub struct TrafficModel {
    streets: Vec<Calle>,
    random_state: u64,
}

impl TrafficModel {
    /// Fixed tracer network: generator, connection and sink, each with two
    /// opposite lanes. Positions remain physical, including in reverse lanes.
    pub fn demo() -> Self {
        let streets = [
            CalleType::Generador,
            CalleType::Conexion,
            CalleType::Devorador,
        ]
        .into_iter()
        .map(|tipo| {
            let mut config = CalleConfig::new(2, 32, tipo);
            config.generation_probability = 0.35;
            config.lane_directions =
                vec![Some(LaneDirection::Forward), Some(LaneDirection::Reverse)];
            let mut cells = vec![0; 64];
            for lane in 0..2 {
                for (i, position) in [5, 14, 23].into_iter().enumerate() {
                    cells[lane * 32 + position] = (lane * 3 + i + 1) as u8;
                }
            }
            cells[18] = 7;
            Calle::new(config, cells).expect("fixed demo is valid")
        })
        .collect();
        Self::new(streets, 42)
    }

    pub fn new(streets: Vec<Calle>, seed: u64) -> Self {
        Self {
            streets,
            random_state: seed,
        }
    }

    pub fn streets(&self) -> &[Calle] {
        &self.streets
    }

    /// Toggle a physical cell without changing special cells or the RNG sequence.
    pub fn toggle_vehicle(&mut self, cell: crate::cell_index::CellRef) -> bool {
        let Some(street) = self.streets.get_mut(cell.street) else {
            return false;
        };
        if cell.lane >= street.config.carriles || cell.index >= street.config.tamano {
            return false;
        }
        let value = &mut street.cells[cell.lane * street.config.tamano + cell.index];
        match *value {
            0 => *value = 1,
            1..=6 => *value = 0,
            _ => return false,
        }
        true
    }

    pub fn tick(&mut self) {
        self.tick_with_hook(|_, _| {});
    }

    /// Observe phase completion without changing the snapshot or RNG sequence.
    /// Connection transfers, lane changes, rain, clock and metrics are no-ops.
    pub fn tick_with_hook(&mut self, mut hook: impl FnMut(TickPhase, &[Calle])) {
        for phase in [
            TickPhase::Generation,
            TickPhase::ConnectionTransfers,
            TickPhase::LaneChanges,
            TickPhase::StreetUpdate,
            TickPhase::Rain,
            TickPhase::Clock,
            TickPhase::Metrics,
        ] {
            match phase {
                TickPhase::Generation => {
                    for street in &mut self.streets {
                        street.generate(&mut self.random_state);
                    }
                }
                TickPhase::StreetUpdate => self.streets.iter_mut().for_each(Calle::update),
                _ => {}
            }
            hook(phase, &self.streets);
        }
    }
}
