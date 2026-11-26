//! Shared parking draft for the inspector and alternative form dialog.
mod ui;
use ca_core::{
    cell_index::CellRef,
    map_json::MapDocument,
    parking::{ParkingConfig, ParkingError, ParkingPair},
};
pub use ui::{ParkingForms, ParkingRequest};

#[derive(Clone, Copy)]
pub enum Preset {
    Normal,
    Office,
    Shopping,
}

#[derive(Clone, Default)]
pub struct EndpointDraft {
    pub street: Option<usize>,
    /// UI addresses start at one. Empty and partial text remain draft data.
    pub lane: String,
    pub cell: String,
}

impl EndpointDraft {
    fn from_cell(cell: CellRef) -> Self {
        Self {
            street: Some(cell.street),
            lane: (cell.lane + 1).to_string(),
            cell: (cell.index + 1).to_string(),
        }
    }

    fn candidate(&self) -> Result<CellRef, ParkingError> {
        let invalid = || ParkingError("parking.validation.incompletePair");
        Ok(CellRef {
            street: self.street.ok_or_else(invalid)?,
            lane: self
                .lane
                .parse::<usize>()
                .ok()
                .and_then(|n| n.checked_sub(1))
                .ok_or_else(invalid)?,
            index: self
                .cell
                .parse::<usize>()
                .ok()
                .and_then(|n| n.checked_sub(1))
                .ok_or_else(invalid)?,
        })
    }
}

#[derive(Clone, Default)]
pub struct PairDraft {
    pub entrance: EndpointDraft,
    pub exit: EndpointDraft,
}

#[derive(Clone)]
pub struct ParkingDraft {
    pub enabled: bool,
    pub capacity: String,
    pub pairs: Vec<PairDraft>,
    /// Percentages, as in the v1 form.
    pub entry: [String; 24],
    pub exit: [String; 24],
}

impl ParkingDraft {
    pub fn preset(&mut self, preset: Preset) {
        let (entry, exit) = match preset {
            Preset::Normal => ([30; 24], [20; 24]),
            Preset::Office => (
                [
                    20, 20, 10, 10, 10, 20, 40, 60, 70, 50, 30, 20, 10, 10, 10, 20, 30, 60, 70, 50,
                    30, 20, 20, 20,
                ],
                [
                    10, 10, 10, 10, 10, 10, 20, 30, 20, 10, 10, 30, 50, 60, 40, 20, 20, 50, 70, 60,
                    40, 20, 10, 10,
                ],
            ),
            Preset::Shopping => (
                [
                    10, 10, 10, 10, 10, 10, 20, 30, 40, 50, 60, 70, 70, 60, 60, 70, 70, 80, 80, 70,
                    50, 40, 30, 20,
                ],
                [
                    10, 10, 10, 10, 10, 10, 10, 10, 10, 20, 30, 40, 50, 50, 40, 50, 60, 70, 80, 80,
                    70, 60, 40, 20,
                ],
            ),
        };
        self.entry = entry.map(|n| n.to_string());
        self.exit = exit.map(|n| n.to_string());
    }

    pub fn new(document: &MapDocument, building: usize) -> Self {
        let config = document.model().parking(building).map(|p| &p.config);
        Self {
            enabled: config.is_some(),
            capacity: config.map_or(100, |c| c.capacity).to_string(),
            pairs: config.map_or_else(Vec::new, |c| {
                c.pairs
                    .iter()
                    .map(|p| PairDraft {
                        entrance: EndpointDraft::from_cell(p.entrance),
                        exit: EndpointDraft::from_cell(p.exit),
                    })
                    .collect()
            }),
            entry: std::array::from_fn(|h| {
                (config.map_or(0.3, |c| c.entry_probabilities[h]) * 100.).to_string()
            }),
            exit: std::array::from_fn(|h| {
                (config.map_or(0.2, |c| c.exit_probabilities[h]) * 100.).to_string()
            }),
        }
    }

    pub fn candidate(
        &self,
        document: &MapDocument,
        building: usize,
    ) -> Result<Option<ParkingConfig>, ParkingError> {
        if building >= document.buildings().len() {
            return Err(ParkingError("parking.validation.buildingRequired"));
        }
        if !self.enabled {
            return Ok(None);
        }
        let mut config = ParkingConfig::new(
            self.capacity
                .parse()
                .map_err(|_| ParkingError("parking.validation.capacityPositive"))?,
            self.pairs
                .iter()
                .map(|pair| {
                    Ok(ParkingPair {
                        entrance: pair.entrance.candidate()?,
                        exit: pair.exit.candidate()?,
                    })
                })
                .collect::<Result<_, ParkingError>>()?,
        );
        for (values, target) in [
            (&self.entry, &mut config.entry_probabilities),
            (&self.exit, &mut config.exit_probabilities),
        ] {
            for (value, target) in values.iter().zip(target) {
                *target = value
                    .parse::<f64>()
                    .map_err(|_| ParkingError("parking.validation.probability"))?
                    / 100.;
            }
        }
        document.model().validate_parking(building, &config)?;
        Ok(Some(config))
    }
}
