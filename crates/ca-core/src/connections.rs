//! Validated physical-cell links. Registration is atomic; ticks allocate nothing.
use super::{Calle, LaneDirection, TrafficModel};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mapping {
    pub source_street: usize,
    pub source_lane: usize,
    /// -1 is the last physical cell, including on reverse lanes.
    pub source_cell: isize,
    pub destination_street: usize,
    pub destination_lane: usize,
    pub destination_cell: usize,
}

impl Mapping {
    pub(crate) fn fits_resized_street(&self, street: usize, lanes: usize, length: usize) -> bool {
        (self.source_street != street
            || (self.source_lane < lanes
                && self.source_cell >= -1
                && self.source_cell < length as isize))
            && (self.destination_street != street
                || (self.destination_lane < lanes && self.destination_cell < length))
    }

    fn source_index(&self, street: &Calle) -> usize {
        self.source_lane * street.config.tamano
            + self
                .effective_source_cell(street)
                .expect("validated source")
    }

    pub fn effective_source_cell(&self, street: &Calle) -> Option<usize> {
        if self.source_cell == -1 {
            Some(street.config().tamano - 1)
        } else {
            usize::try_from(self.source_cell)
                .ok()
                .filter(|&cell| cell < street.config().tamano)
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct MergeRow {
    pub mapping: Mapping,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WeightedRow {
    pub mapping: Mapping,
    pub weight: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Connection {
    Lineal(Mapping),
    Incorporacion(Vec<MergeRow>),
    /// A v1 saved link: one independent probability trial at this point in
    /// registration order, not one destination in a weighted split.
    ProbabilityTrial(WeightedRow),
    /// Independent per-mapping chances, tested in registration order. No required total.
    ProbabilityTrials(Vec<WeightedRow>),
    /// Legacy v2 weighted split. All rows share a source; weights sum to one.
    Probabilistica(Vec<WeightedRow>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConnectionKind {
    Linear,
    Incorporation,
    Probabilistic,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ConnectionArrow {
    pub endpoints: [[f32; 2]; 2],
    pub kind: ConnectionKind,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Registration {
    New,
    Replacement,
    Saved,
}

impl Connection {
    pub fn kind(&self) -> ConnectionKind {
        match self {
            Self::Lineal(_) => ConnectionKind::Linear,
            Self::Incorporacion(_) => ConnectionKind::Incorporation,
            Self::ProbabilityTrial(_) | Self::ProbabilityTrials(_) | Self::Probabilistica(_) => {
                ConnectionKind::Probabilistic
            }
        }
    }
    // Probability exits hold only after an occupied-destination trial has set
    // waiting. Disabled merge rows and inert self-links do not hold traffic.
    fn holding_exits(&self) -> impl Iterator<Item = &Mapping> {
        let (single, merge): (Option<&Mapping>, &[MergeRow]) = match self {
            Self::Lineal(row) => (Some(row), &[]),
            Self::Incorporacion(rows) => (None, rows),
            _ => (None, &[]),
        };
        single
            .into_iter()
            .chain(merge.iter().filter(|r| r.enabled).map(|r| &r.mapping))
    }

    pub(crate) fn remap_roundabout(&mut self, street: usize, old: usize, new: usize) {
        let remap = |m: &mut Mapping| {
            if m.source_street == street && m.source_cell >= 0 {
                m.source_cell =
                    crate::streets::angular_index(m.source_cell as usize, old, new) as isize;
            }
            if m.destination_street == street {
                m.destination_cell = crate::streets::angular_index(m.destination_cell, old, new);
            }
        };
        match self {
            Self::Lineal(m) => remap(m),
            Self::ProbabilityTrial(r) => remap(&mut r.mapping),
            Self::Incorporacion(rows) => rows.iter_mut().for_each(|r| remap(&mut r.mapping)),
            Self::ProbabilityTrials(rows) | Self::Probabilistica(rows) => {
                rows.iter_mut().for_each(|r| remap(&mut r.mapping))
            }
        }
    }

    pub(crate) fn retain_mappings(&mut self, keep: impl Fn(&Mapping) -> bool) -> bool {
        match self {
            Self::Lineal(m) => keep(m),
            Self::ProbabilityTrial(r) => keep(&r.mapping),
            Self::ProbabilityTrials(rows) => {
                rows.retain(|r| keep(&r.mapping));
                !rows.is_empty()
            }
            Self::Incorporacion(rows) => {
                rows.retain(|r| keep(&r.mapping));
                !rows.is_empty()
            }
            Self::Probabilistica(rows) => {
                rows.retain(|r| keep(&r.mapping));
                if rows.is_empty() {
                    return false;
                }
                // Retain the remaining destinations as one weighted choice.
                let sum: f64 = rows.iter().map(|r| r.weight).sum();
                let count = rows.len() as f64;
                for row in rows {
                    row.weight = if sum > 0.0 {
                        row.weight / sum
                    } else {
                        1.0 / count
                    };
                }
                true
            }
        }
    }

    pub(crate) fn remap_after_deletion(&mut self, street: usize) {
        let remap = |m: &mut Mapping| {
            m.source_street -= usize::from(m.source_street > street);
            m.destination_street -= usize::from(m.destination_street > street);
        };
        match self {
            Self::Lineal(m) => remap(m),
            Self::ProbabilityTrial(r) => remap(&mut r.mapping),
            Self::Incorporacion(rows) => rows.iter_mut().for_each(|r| remap(&mut r.mapping)),
            Self::ProbabilityTrials(rows) | Self::Probabilistica(rows) => {
                rows.iter_mut().for_each(|r| remap(&mut r.mapping))
            }
        }
    }

    /// Includes disabled merge rows, so editors can display the full link.
    pub fn mappings(&self) -> impl Iterator<Item = &Mapping> {
        let (single, merge, split): (Option<&Mapping>, &[MergeRow], &[WeightedRow]) = match self {
            Self::Lineal(row) => (Some(row), &[], &[]),
            Self::ProbabilityTrial(row) => (Some(&row.mapping), &[], &[]),
            Self::Incorporacion(rows) => (None, rows, &[]),
            Self::ProbabilityTrials(rows) | Self::Probabilistica(rows) => (None, &[], rows),
        };
        single
            .into_iter()
            .chain(merge.iter().map(|r| &r.mapping))
            .chain(split.iter().map(|r| &r.mapping))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
pub enum ConnectionError {
    #[error("invalid street, lane, or physical cell")]
    InvalidMapping,
    #[error("mapping opposes lane direction")]
    Direction,
    #[error("duplicate mapping")]
    Duplicate,
    #[error("at least one merge row must be enabled")]
    NoActiveRows,
    #[error("splits need at least two destinations with finite fractional weights summing to one")]
    Weights,
    #[error("split rows must share a source")]
    SplitSource,
    #[error("probability must be finite and in 0..=1")]
    Probability,
}

impl ConnectionError {
    /// Stable message key; the app translates the reason at the UI boundary.
    pub fn translation_key(self) -> &'static str {
        match self {
            Self::InvalidMapping => "connections.invalidMapping",
            Self::Direction => "connections.direction",
            Self::Duplicate => "connections.duplicate",
            Self::NoActiveRows => "connections.noActiveRows",
            Self::Weights => "connections.weights",
            Self::SplitSource => "connections.splitSource",
            Self::Probability => "connections.probability",
        }
    }
}

impl TrafficModel {
    pub fn connections(&self) -> &[Connection] {
        &self.connections
    }

    pub fn connection_direction_compatible(&self, connection: &Connection) -> bool {
        if let Connection::Incorporacion(rows) = connection {
            return rows
                .iter()
                .all(|row| !row.enabled || self.resolve(&row.mapping, true).is_ok());
        }
        connection
            .mappings()
            .all(|row| self.resolve(row, true).is_ok())
    }

    fn resolve(
        &self,
        row: &Mapping,
        check_direction: bool,
    ) -> Result<(usize, usize), ConnectionError> {
        let source = self
            .streets
            .get(row.source_street)
            .ok_or(ConnectionError::InvalidMapping)?;
        let destination = self
            .streets
            .get(row.destination_street)
            .ok_or(ConnectionError::InvalidMapping)?;
        let cell = row
            .effective_source_cell(source)
            .ok_or(ConnectionError::InvalidMapping)?;
        if row.source_lane >= source.config.carriles
            || row.destination_lane >= destination.config.carriles
            || row.destination_cell >= destination.config.tamano
        {
            return Err(ConnectionError::InvalidMapping);
        }
        if check_direction
            && ((source.lane_direction(row.source_lane) == LaneDirection::Reverse
                && !source.config.periodic
                && cell == source.config.tamano - 1
                && source.config.tamano > 1)
                || (destination.lane_direction(row.destination_lane) == LaneDirection::Reverse
                    && !destination.config.periodic
                    && row.destination_cell == 0
                    && destination.config.tamano > 1))
        {
            return Err(ConnectionError::Direction);
        }
        Ok((
            row.source_lane * source.config.tamano + cell,
            row.destination_lane * destination.config.tamano + row.destination_cell,
        ))
    }

    pub fn add_connection(&mut self, connection: Connection) -> Result<(), ConnectionError> {
        self.register_connection(connection, Registration::New)
    }

    /// Saved links remain editable after a lane direction change.
    pub(crate) fn add_saved_connection(
        &mut self,
        connection: Connection,
    ) -> Result<(), ConnectionError> {
        self.register_connection(connection, Registration::Saved)
    }

    fn register_connection(
        &mut self,
        connection: Connection,
        policy: Registration,
    ) -> Result<(), ConnectionError> {
        self.validate_registration(&connection, policy)?;
        for row in connection.holding_exits() {
            let source = &mut self.streets[row.source_street];
            let index = row.source_index(source);
            if row.source_street != row.destination_street
                || index != row.destination_lane * source.config.tamano + row.destination_cell
            {
                source.outgoing[index] = true;
            }
        }
        self.connections.push(connection);
        Ok(())
    }

    /// Check a new link without changing traffic, outgoing cells, or topology.
    pub fn validate_connection(&self, connection: &Connection) -> Result<(), ConnectionError> {
        self.validate_registration(connection, Registration::New)
    }

    pub fn validate_connection_replacement(
        &self,
        index: usize,
        connection: &Connection,
    ) -> Result<(), ConnectionError> {
        if index >= self.connections.len() {
            return Err(ConnectionError::InvalidMapping);
        }
        self.validate_registration_except(connection, Registration::Replacement, Some(index))
    }

    pub fn replace_connection(
        &mut self,
        index: usize,
        connection: Connection,
    ) -> Result<(), ConnectionError> {
        self.validate_connection_replacement(index, &connection)?;
        self.connections[index] = connection;
        self.refresh_outgoing();
        Ok(())
    }

    pub fn delete_connection(&mut self, index: usize) -> bool {
        if index >= self.connections.len() {
            return false;
        }
        self.connections.remove(index);
        self.refresh_outgoing();
        true
    }

    fn validate_registration(
        &self,
        connection: &Connection,
        policy: Registration,
    ) -> Result<(), ConnectionError> {
        self.validate_registration_except(connection, policy, None)
    }

    fn validate_registration_except(
        &self,
        connection: &Connection,
        policy: Registration,
        excluding: Option<usize>,
    ) -> Result<(), ConnectionError> {
        let strict = policy != Registration::Saved;
        match connection {
            Connection::ProbabilityTrial(row)
                if !row.weight.is_finite() || !(0.0..=1.0).contains(&row.weight) =>
            {
                return Err(ConnectionError::Probability);
            }
            Connection::ProbabilityTrials(rows) => {
                if rows.is_empty() {
                    return Err(ConnectionError::InvalidMapping);
                }
                if rows
                    .iter()
                    .any(|r| !r.weight.is_finite() || !(0.0..=1.0).contains(&r.weight))
                {
                    return Err(ConnectionError::Probability);
                }
            }
            Connection::Incorporacion(rows)
                if policy == Registration::New && !rows.iter().any(|r| r.enabled) =>
            {
                return Err(ConnectionError::NoActiveRows);
            }
            Connection::Probabilistica(rows) => {
                if rows.is_empty()
                    || (strict && rows.len() < 2)
                    || rows
                        .iter()
                        .any(|r| !r.weight.is_finite() || !(0.0..=1.0).contains(&r.weight))
                    || (rows.iter().map(|r| r.weight).sum::<f64>() - 1.0).abs() > 1e-9
                {
                    return Err(ConnectionError::Weights);
                }
                let first = &rows[0].mapping;
                for row in rows {
                    let m = &row.mapping;
                    self.resolve(m, strict)?;
                    if m.source_street != first.source_street
                        || self.resolve(m, strict)?.0 != self.resolve(first, strict)?.0
                    {
                        return Err(ConnectionError::SplitSource);
                    }
                }
            }
            _ => {}
        }
        for (index, row) in connection.mappings().enumerate() {
            // Retain inactive saved configuration, even after a direction edit.
            // Its physical endpoints and duplicate constraints still apply.
            let inactive = policy == Registration::Replacement
                && matches!(connection, Connection::Incorporacion(rows) if !rows[index].enabled);
            let resolved = self.resolve(row, strict && !inactive)?;
            let duplicate = |other: &Mapping| {
                row.source_street == other.source_street
                    && row.destination_street == other.destination_street
                    && self
                        .resolve(other, false)
                        .is_ok_and(|pair| pair == resolved)
                    // A resize can make distinct saved source forms equivalent.
                    && (strict || row.source_cell == other.source_cell)
            };
            if (row.source_street == row.destination_street
                && resolved.0 == resolved.1
                && (strict || row.source_cell != -1))
                || connection.mappings().take(index).any(duplicate)
                || self
                    .connections
                    .iter()
                    .enumerate()
                    .filter(|(index, _)| Some(*index) != excluding)
                    .map(|(_, link)| link)
                    .flat_map(Connection::mappings)
                    .any(duplicate)
            {
                return Err(ConnectionError::Duplicate);
            }
        }
        Ok(())
    }

    /// Rebuild only after topology changes, never during traffic updates.
    pub(crate) fn refresh_outgoing(&mut self) {
        for street in &mut self.streets {
            street.outgoing.fill(false);
        }
        for connection in &self.connections {
            for row in connection.holding_exits() {
                let source = &mut self.streets[row.source_street];
                let index = row.source_index(source);
                if row.source_street != row.destination_street
                    || index != row.destination_lane * source.config.tamano + row.destination_cell
                {
                    source.outgoing[index] = true;
                }
            }
        }
    }

    /// Endpoints in the supplied geometry's world frame, in registration order.
    pub fn connection_arrows(
        &self,
        geometry: &[crate::cell_index::StreetGeometry],
    ) -> Vec<ConnectionArrow> {
        self.connections
            .iter()
            .flat_map(|connection| {
                connection
                    .mappings()
                    .map(move |row| (connection.kind(), row))
            })
            .map(|(kind, row)| {
                let source = row
                    .effective_source_cell(&self.streets[row.source_street])
                    .expect("registered source");
                ConnectionArrow {
                    kind,
                    endpoints: [
                        geometry[row.source_street].centers[row.source_lane][source],
                        geometry[row.destination_street].centers[row.destination_lane]
                            [row.destination_cell],
                    ],
                }
            })
            .collect()
    }

    /// Run only the transfer phase, also useful for network diagnostics.
    pub fn transfer_connections(&mut self) {
        for connection in &self.connections {
            match connection {
                Connection::Lineal(row) => transfer(&mut self.streets, row),
                Connection::ProbabilityTrial(row) => {
                    probability_trial(&mut self.streets, &mut self.random_state, row);
                }
                Connection::ProbabilityTrials(rows) => {
                    for row in rows {
                        probability_trial(&mut self.streets, &mut self.random_state, row);
                    }
                }
                Connection::Incorporacion(rows) => {
                    for row in rows.iter().filter(|r| r.enabled) {
                        transfer(&mut self.streets, &row.mapping);
                    }
                }
                Connection::Probabilistica(rows) => {
                    let source = &rows[0].mapping;
                    let street = &self.streets[source.source_street];
                    let cell = source.source_index(street);
                    if !(1..=6).contains(&street.cells[cell]) || street.waiting[cell] {
                        continue;
                    }
                    let roll = crate::random::unit(&mut self.random_state);
                    let mut cumulative = 0.0;
                    for row in rows {
                        cumulative += row.weight;
                        if roll < cumulative {
                            transfer(&mut self.streets, &row.mapping);
                            break;
                        }
                    }
                }
            }
        }
    }
}

fn probability_trial(streets: &mut [Calle], random_state: &mut u64, row: &WeightedRow) {
    let source = &streets[row.mapping.source_street];
    if (1..=6).contains(&source.cells[row.mapping.source_index(source)])
        && crate::random::unit(random_state) < row.weight
    {
        transfer(streets, &row.mapping);
    }
}

fn transfer(streets: &mut [Calle], row: &Mapping) {
    let source = &streets[row.source_street];
    let source_cell = row.source_index(source);
    if row.source_street == row.destination_street
        && source_cell == row.destination_lane * source.config.tamano + row.destination_cell
    {
        return;
    }
    let value = source.cells[source_cell];
    if !(1..=6).contains(&value) {
        return;
    }
    let destination = &streets[row.destination_street];
    let destination_cell = row.destination_lane * destination.config.tamano + row.destination_cell;
    if destination.cells[destination_cell] != 0 {
        streets[row.source_street].waiting[source_cell] = true;
    } else if !source.waiting[source_cell] {
        streets[row.source_street].cells[source_cell] = 0;
        streets[row.destination_street].cells[destination_cell] = value;
    }
}
