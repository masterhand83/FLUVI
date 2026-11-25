//! Traffic CA for ordinary streets, with physical (not travel-relative) indices.

#[path = "connections.rs"]
pub mod connections;

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

/// One-shot transport actions. Probability is a fraction in 0..=1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum VehicleAction {
    Clear,
    Fill(f64),
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
    #[error("hourly multiplier must be finite and nonnegative")]
    Multiplier,
}

#[derive(Clone, Debug)]
pub struct Calle {
    config: CalleConfig,
    cells: Vec<u8>,
    next: Vec<u8>,
    waiting: Vec<bool>,
    destinations: Vec<usize>,
    reserved: Vec<bool>,
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
            waiting: vec![false; size],
            destinations: vec![usize::MAX; size],
            reserved: vec![false; size],
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

    /// Mark a physical cell as waiting for this tick's connection phase.
    pub fn set_waiting(&mut self, lane: usize, index: usize, waiting: bool) -> bool {
        if lane >= self.config.carriles || index >= self.config.tamano {
            return false;
        }
        self.waiting[lane * self.config.tamano + index] = waiting;
        true
    }

    fn change_lanes(&mut self, random_state: &mut u64) {
        let size = self.config.tamano;
        if self.config.carriles < 2 || size < 3 || self.config.lane_change_probability <= 0.0 {
            return;
        }
        self.destinations.fill(usize::MAX);
        self.reserved.fill(false);
        for lane in 0..self.config.carriles {
            let direction = self.lane_direction(lane);
            for index in 1..size - 1 {
                let source = lane * size + index;
                if !(1..=6).contains(&self.cells[source]) || self.waiting[source] {
                    continue;
                }
                let ahead = |offset| match direction {
                    LaneDirection::Forward => index.checked_add(offset).filter(|&i| i < size),
                    LaneDirection::Reverse => index.checked_sub(offset),
                };
                let obstructed = (1..=3)
                    .filter_map(ahead)
                    .any(|i| self.cells[lane * size + i] == 7);
                let probability = if obstructed {
                    0.30
                } else {
                    self.config.lane_change_probability
                };
                if crate::random::unit(random_state) >= probability {
                    continue;
                }
                let target_index = ahead(1).expect("interior cell");
                let mut available = [0; 2];
                let mut count = 0;
                for target_lane in [
                    lane.checked_sub(1),
                    (lane + 1 < self.config.carriles).then_some(lane + 1),
                ]
                .into_iter()
                .flatten()
                {
                    let target = target_lane * size + target_index;
                    if self.lane_direction(target_lane) == direction
                        && self.cells[target] == 0
                        && !self.waiting[target]
                        && !self.reserved[target]
                    {
                        available[count] = target;
                        count += 1;
                    }
                }
                if count > 0 {
                    let target =
                        available[(crate::random::unit(random_state) * count as f64) as usize];
                    self.destinations[source] = target;
                    self.reserved[target] = true;
                }
            }
        }
        self.next.copy_from_slice(&self.cells);
        for (source, &target) in self.destinations.iter().enumerate() {
            if target == usize::MAX {
                continue;
            }
            // Reciprocal diagonals from the same column cross in an X.
            let other_source = target / size * size + source % size;
            let other_target = self.destinations[other_source];
            if other_target != usize::MAX
                && other_target / size == source / size
                && other_target % size == target % size
            {
                continue;
            }
            self.next[source] = 0;
            self.next[target] = self.cells[source];
            // V1 holds the arrival and forward neighbors for the street update,
            // but leaves the vacated source free to receive an upstream vehicle.
            self.waiting[target] = true;
            let next_target = match self.lane_direction(target / size) {
                LaneDirection::Forward => (target % size + 1 < size).then_some(target + 1),
                LaneDirection::Reverse => (target % size).checked_sub(1).map(|_| target - 1),
            };
            if let Some(next_target) = next_target {
                self.waiting[next_target] = true;
            }
            self.waiting[source / size * size + target % size] = true;
        }
        std::mem::swap(&mut self.cells, &mut self.next);
    }

    fn generate(
        &mut self,
        random_state: &mut u64,
        override_probability: Option<f64>,
        multiplier: f64,
    ) {
        if self.config.tipo != CalleType::Generador {
            return;
        }
        let probability =
            override_probability.unwrap_or(self.config.generation_probability) * multiplier;
        for lane in 0..self.config.carriles {
            if self.config.lane_generation_enabled.get(lane) == Some(&Some(false)) {
                continue;
            }
            let entry = lane * self.config.tamano + self.entry_cell(lane);
            if self.cells[entry] == 0 && crate::random::unit(random_state) < probability {
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
                    if self.waiting[start + i] {
                        continue;
                    }
                    let left = i.checked_sub(1).map(|p| self.cells[start + p]).unwrap_or(0);
                    let right = if i + 1 < size {
                        self.cells[start + i + 1]
                    } else {
                        0
                    };
                    let center = self.cells[start + i];
                    let (mut upstream, downstream) = if reverse {
                        (right, left)
                    } else {
                        (left, right)
                    };
                    let previous = if reverse {
                        i.checked_add(1).filter(|&p| p < size)
                    } else {
                        i.checked_sub(1)
                    };
                    if previous.is_some_and(|p| self.waiting[start + p]) {
                        upstream = 0;
                    }
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
        self.waiting.fill(false);
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

/// Hooks run after each phase.
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
    connections: Vec<connections::Connection>,
    random_state: u64,
    generation_override: Option<f64>,
    hourly_multiplier: f64,
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
        let mut model = Self::new(streets, 42);
        for source_street in 0..2 {
            for lane in 0..2 {
                model
                    .add_connection(connections::Connection::Lineal(connections::Mapping {
                        source_street,
                        source_lane: lane,
                        source_cell: if lane == 0 { -1 } else { 0 },
                        destination_street: source_street + 1,
                        destination_lane: lane,
                        destination_cell: if lane == 0 { 0 } else { 31 },
                    }))
                    .expect("fixed demo link is valid");
            }
        }
        model
    }

    pub fn new(streets: Vec<Calle>, seed: u64) -> Self {
        Self {
            streets,
            connections: Vec::new(),
            random_state: seed,
            generation_override: None,
            hourly_multiplier: 1.0,
        }
    }

    pub fn streets(&self) -> &[Calle] {
        &self.streets
    }

    /// Session state: never writes the stored street configuration.
    pub fn set_generation_override(
        &mut self,
        probability: Option<f64>,
    ) -> Result<(), TrafficError> {
        if probability.is_some_and(|p| !p.is_finite() || !(0.0..=1.0).contains(&p)) {
            return Err(TrafficError::Probability);
        }
        self.generation_override = probability;
        Ok(())
    }

    /// Input for the clock/profile module; defaults to 1 before that port.
    pub fn set_hourly_multiplier(&mut self, multiplier: f64) -> Result<(), TrafficError> {
        if !multiplier.is_finite() || multiplier < 0.0 {
            return Err(TrafficError::Multiplier);
        }
        self.hourly_multiplier = multiplier;
        Ok(())
    }

    pub fn clear_vehicles(&mut self) {
        for street in &mut self.streets {
            for cell in &mut street.cells {
                if (1..=6).contains(cell) {
                    *cell = 0;
                }
            }
            street.waiting.fill(false);
        }
    }

    pub fn random_fill(&mut self, probability: f64) -> Result<(), TrafficError> {
        if !probability.is_finite() || !(0.0..=1.0).contains(&probability) {
            return Err(TrafficError::Probability);
        }
        for street in &mut self.streets {
            for cell in &mut street.cells {
                if *cell == 0 && crate::random::unit(&mut self.random_state) < probability {
                    *cell = (crate::random::unit(&mut self.random_state) * 6.0) as u8 + 1;
                }
            }
        }
        Ok(())
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
    /// Rain, clock and metrics are not yet ported.
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
                        street.generate(
                            &mut self.random_state,
                            self.generation_override,
                            self.hourly_multiplier,
                        );
                    }
                }
                TickPhase::StreetUpdate => self.streets.iter_mut().for_each(Calle::update),
                TickPhase::ConnectionTransfers => self.transfer_connections(),
                TickPhase::LaneChanges => {
                    for street in &mut self.streets {
                        street.change_lanes(&mut self.random_state);
                    }
                }
                _ => {}
            }
            hook(phase, &self.streets);
        }
    }
}
