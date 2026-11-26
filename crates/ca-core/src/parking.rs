//! Functional parking. Endpoints use physical street/lane/cell addresses.
use super::TrafficModel;
use crate::cell_index::CellRef;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParkingPair {
    pub entrance: CellRef,
    pub exit: CellRef,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ParkingConfig {
    pub capacity: usize,
    pub pairs: Vec<ParkingPair>,
    pub entry_probabilities: [f64; 24],
    pub exit_probabilities: [f64; 24],
}

impl ParkingConfig {
    pub fn new(capacity: usize, pairs: Vec<ParkingPair>) -> Self {
        Self {
            capacity,
            pairs,
            entry_probabilities: [0.3; 24],
            exit_probabilities: [0.2; 24],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParkingError(pub &'static str);

impl ParkingError {
    pub fn translation_key(self) -> &'static str {
        self.0
    }
}

#[derive(Clone, Debug)]
pub struct Parking {
    pub config: ParkingConfig,
    occupied: usize,
}

impl Parking {
    pub fn occupied(&self) -> usize {
        self.occupied
    }
}

impl TrafficModel {
    pub fn parking(&self, building: usize) -> Option<&Parking> {
        self.parking.get(building).and_then(Option::as_ref)
    }

    pub fn validate_parking(
        &self,
        building: usize,
        config: &ParkingConfig,
    ) -> Result<(), ParkingError> {
        let error = |key| Err(ParkingError(key));
        if config.capacity == 0 {
            return error("parking.validation.capacityPositive");
        }
        if self
            .parking(building)
            .is_some_and(|p| p.occupied > config.capacity)
        {
            return error("parking.validation.capacityBelowOccupancy");
        }
        if config.pairs.is_empty() || config.pairs.len() > 10 {
            return error("parking.validation.pairCount");
        }
        if config
            .entry_probabilities
            .iter()
            .chain(&config.exit_probabilities)
            .any(|p| !p.is_finite() || !(0. ..=1.).contains(p))
        {
            return error("parking.validation.probability");
        }
        let mut used = Vec::with_capacity(config.pairs.len() * 2);
        for pair in &config.pairs {
            for (endpoint, key) in [
                (pair.entrance, "parking.validation.entranceEndpointInvalid"),
                (pair.exit, "parking.validation.exitEndpointInvalid"),
            ] {
                if !self.streets.get(endpoint.street).is_some_and(|s| {
                    endpoint.lane < s.config.carriles && endpoint.index < s.config.tamano
                }) {
                    return error(key);
                }
                if used.contains(&endpoint) {
                    return error("parking.validation.duplicateEndpoint");
                }
                used.push(endpoint);
                if self.parking.iter().enumerate().any(|(i, p)| {
                    i != building
                        && p.as_ref().is_some_and(|p| {
                            p.config
                                .pairs
                                .iter()
                                .any(|p| p.entrance == endpoint || p.exit == endpoint)
                        })
                }) {
                    return error("parking.validation.endpointOwned");
                }
            }
        }
        Ok(())
    }

    /// Validate the complete candidate before releasing any owned endpoint.
    pub fn configure_parking(
        &mut self,
        building: usize,
        config: Option<ParkingConfig>,
    ) -> Result<(), ParkingError> {
        if let Some(config) = &config {
            self.validate_parking(building, config)?;
        }
        let occupied = self.parking(building).map_or(0, Parking::occupied);
        if building >= self.parking.len() {
            self.parking.resize_with(building + 1, || None);
        }
        self.parking[building] = config.map(|config| Parking { config, occupied });
        self.refresh_parking_endpoints();
        Ok(())
    }

    pub(crate) fn delete_parking_building(&mut self, building: usize) {
        if building < self.parking.len() {
            self.parking.remove(building);
        }
        self.refresh_parking_endpoints();
    }

    pub fn reset_parking_occupancy(&mut self) {
        for parking in self.parking.iter_mut().flatten() {
            parking.occupied = 0;
        }
    }

    pub fn set_parking_hour(&mut self, hour: usize) {
        assert!(hour < 24);
        self.parking_hour = hour;
    }

    pub(crate) fn prune_parking(&mut self, deleted: Option<usize>) {
        for parking in self.parking.iter_mut().flatten() {
            parking.config.pairs.retain_mut(|pair| {
                for cell in [&mut pair.entrance, &mut pair.exit] {
                    if let Some(deleted) = deleted {
                        if cell.street == deleted {
                            return false;
                        }
                        if cell.street > deleted {
                            cell.street -= 1;
                        }
                    }
                    if !self.streets.get(cell.street).is_some_and(|s| {
                        cell.lane < s.config.carriles && cell.index < s.config.tamano
                    }) {
                        return false;
                    }
                }
                true
            });
        }
        for parking in &mut self.parking {
            if parking.as_ref().is_some_and(|p| p.config.pairs.is_empty()) {
                *parking = None;
            }
        }
        self.refresh_parking_endpoints();
    }

    fn refresh_parking_endpoints(&mut self) {
        for street in &mut self.streets {
            street.parking_endpoints.fill(None);
            street.has_parking = false;
        }
        for (building, parking) in self.parking.iter().enumerate() {
            let Some(parking) = parking else { continue };
            for pair in &parking.config.pairs {
                for (cell, entrance) in [(pair.entrance, true), (pair.exit, false)] {
                    let street = &mut self.streets[cell.street];
                    street.parking_endpoints[cell.lane * street.config.tamano + cell.index] =
                        Some((building, entrance));
                    street.has_parking = true;
                }
            }
        }
    }

    pub(super) fn resolve_parking(&mut self) {
        // Physical order matches v1. Every decision reads the unchanged CA snapshot.
        for street in &mut self.streets {
            if !street.has_parking {
                continue;
            }
            let size = street.config.tamano;
            for lane in 0..street.config.carriles {
                for index in 0..size {
                    let offset = lane * size + index;
                    let Some((building, entrance)) = street.parking_endpoints[offset] else {
                        continue;
                    };
                    let parking = self.parking[building]
                        .as_mut()
                        .expect("registered endpoint");
                    if street.waiting[offset] {
                        continue;
                    }
                    let previous = match street.lane_direction(lane) {
                        super::LaneDirection::Forward => index
                            .checked_sub(1)
                            .or_else(|| street.config.periodic.then_some(size - 1)),
                        super::LaneDirection::Reverse => (index + 1 < size)
                            .then_some(index + 1)
                            .or_else(|| street.config.periodic.then_some(0)),
                    };
                    let upstream = previous.map_or(0, |i| street.cells[lane * size + i]);
                    if entrance && parking.occupied < parking.config.capacity {
                        let source = if (1..=6).contains(&street.cells[offset]) {
                            Some(offset)
                        } else if street.cells[offset] == 0 && (1..=6).contains(&upstream) {
                            previous.map(|i| lane * size + i)
                        } else {
                            None
                        };
                        if let Some(source) = source
                            && !street.waiting[source]
                            && !street.consumed[source]
                            && crate::random::unit(&mut self.random_state)
                                < parking.config.entry_probabilities[self.parking_hour]
                        {
                            street.consumed[source] = true;
                            parking.occupied += 1;
                        }
                    } else if !entrance
                        && street.cells[offset] == 0
                        && upstream == 0
                        && parking.occupied > 0
                        && crate::random::unit(&mut self.random_state)
                            < parking.config.exit_probabilities[self.parking_hour]
                    {
                        street.spawned[offset] =
                            (crate::random::unit(&mut self.random_state) * 6.) as u8 + 1;
                        parking.occupied -= 1;
                    }
                }
            }
        }
    }
}
