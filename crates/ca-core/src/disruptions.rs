//! Scenario cells and safe one-shot actions. Addresses are lane-major physical cells.
use super::{TrafficError, TrafficModel};
use crate::cell_index::CellRef;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Disruption {
    LaneBlock = 1,
    Flood,
    Pothole,
    Worker,
    Tree,
    Cone,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScenarioAction {
    /// Initial paint press: remove a blocker, or paint an empty cell.
    Click(CellRef, Disruption),
    Paint(CellRef, Disruption),
    InstantFlood(u8),
    Clear,
    MassFlood,
    RandomPotholes,
}

impl TrafficModel {
    pub fn rain(&self) -> (bool, f64) {
        (self.rain, self.rain_probability)
    }

    pub(crate) fn set_scenario_cell(&mut self, cell: CellRef, mark: Disruption) {
        let street = &mut self.streets[cell.street];
        let offset = cell.lane * street.config.tamano + cell.index;
        street.cells[offset] = 7;
        street.marks[offset] = Some(mark);
    }

    pub fn set_rain(&mut self, active: bool, probability: f64) -> Result<(), TrafficError> {
        if !probability.is_finite() || !(0.0..=1.0).contains(&probability) {
            return Err(TrafficError::Probability);
        }
        self.rain = active;
        self.rain_probability = probability;
        Ok(())
    }

    /// Two uniform choices without allocating an eligible-street/cell list per tick.
    pub(super) fn apply_rain(&mut self) {
        if !self.rain
            || self.rain_probability <= 0.
            || crate::random::unit(&mut self.random_state) >= self.rain_probability
        {
            return;
        }
        let empty_count = |s: &super::Calle| {
            s.cells
                .iter()
                .enumerate()
                .filter(|&(i, v)| *v == 0 && s.parking_endpoints[i].is_none())
                .count()
        };
        let eligible = self.streets.iter().filter(|s| empty_count(s) > 0).count();
        if eligible == 0 {
            return;
        }
        let choice = (crate::random::unit(&mut self.random_state) * eligible as f64) as usize;
        let street = self
            .streets
            .iter_mut()
            .filter(|s| empty_count(s) > 0)
            .nth(choice)
            .expect("eligible street");
        let choice =
            (crate::random::unit(&mut self.random_state) * empty_count(street) as f64) as usize;
        let offset = street
            .cells
            .iter()
            .enumerate()
            .filter(|&(i, v)| *v == 0 && street.parking_endpoints[i].is_none())
            .nth(choice)
            .expect("empty cell")
            .0;
        street.cells[offset] = 7;
        street.marks[offset] = Some(Disruption::Flood);
    }

    pub fn disruption(&self, cell: CellRef) -> Option<Disruption> {
        let street = self.streets.get(cell.street)?;
        if cell.lane >= street.config.carriles || cell.index >= street.config.tamano {
            return None;
        }
        street.marks[cell.lane * street.config.tamano + cell.index]
    }

    pub fn disrupt(&mut self, action: ScenarioAction) -> Result<usize, TrafficError> {
        match action {
            ScenarioAction::MassFlood | ScenarioAction::RandomPotholes => {
                self.disrupt(ScenarioAction::Clear)?;
                let mut count = 0;
                for street in &mut self.streets {
                    for offset in 0..street.cells.len() {
                        if street.cells[offset] != 0 || street.parking_endpoints[offset].is_some() {
                            continue;
                        }
                        let mark = if action == ScenarioAction::MassFlood {
                            (offset >= street.config.tamano).then_some(Disruption::Flood)
                        } else {
                            (crate::random::unit(&mut self.random_state) < 0.05)
                                .then_some(Disruption::Pothole)
                        };
                        if let Some(mark) = mark {
                            street.cells[offset] = 7;
                            street.marks[offset] = Some(mark);
                            count += 1;
                        }
                    }
                }
                Ok(count)
            }
            ScenarioAction::Paint(cell, mark) | ScenarioAction::Click(cell, mark) => {
                let Some(street) = self.streets.get_mut(cell.street) else {
                    return Ok(0);
                };
                if cell.lane >= street.config.carriles || cell.index >= street.config.tamano {
                    return Ok(0);
                }
                let offset = cell.lane * street.config.tamano + cell.index;
                if matches!(action, ScenarioAction::Click(..)) && street.cells[offset] == 7 {
                    street.cells[offset] = 0;
                    street.marks[offset] = None;
                    return Ok(1);
                }
                if street.cells[offset] != 0 || street.parking_endpoints[offset].is_some() {
                    return Ok(0);
                }
                street.cells[offset] = 7;
                street.marks[offset] = Some(mark);
                Ok(1)
            }
            ScenarioAction::Clear => {
                let mut count = 0;
                for street in &mut self.streets {
                    for cell in &mut street.cells {
                        if *cell == 7 {
                            *cell = 0;
                            count += 1;
                        }
                    }
                    street.marks.fill(None);
                }
                Ok(count)
            }
            ScenarioAction::InstantFlood(percent) => {
                if !(1..=100).contains(&percent) {
                    return Err(TrafficError::Probability);
                }
                let total: usize = self.streets.iter().map(|s| s.cells.len()).sum();
                let mut empty = Vec::new();
                for (street, road) in self.streets.iter().enumerate() {
                    for (offset, &value) in road.cells.iter().enumerate() {
                        if value == 0 && road.parking_endpoints[offset].is_none() {
                            empty.push((street, offset));
                        }
                    }
                }
                let count =
                    ((total as f64 * f64::from(percent) / 100.).round() as usize).min(empty.len());
                for i in 0..count {
                    let j = i
                        + (crate::random::unit(&mut self.random_state) * (empty.len() - i) as f64)
                            as usize;
                    empty.swap(i, j);
                    let (street, offset) = empty[i];
                    self.streets[street].cells[offset] = 7;
                    self.streets[street].marks[offset] = Some(Disruption::Flood);
                }
                Ok(count)
            }
        }
    }
}
