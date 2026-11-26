use super::*;
use crate::{
    buildings::BuildingError,
    cell_index::CellRef,
    parking::{ParkingConfig, ParkingError, ParkingPair},
};

impl MapDocument {
    pub fn configure_parking(
        &mut self,
        building: usize,
        config: Option<ParkingConfig>,
    ) -> Result<(), ParkingError> {
        if building >= self.buildings.len() {
            return Err(ParkingError("parking.validation.buildingRequired"));
        }
        self.model.configure_parking(building, config)?;
        if self.model.parking(building).is_none() {
            let mut value = self.buildings[building].parking_fields();
            value["esEstacionamiento"] = json!(false);
            value["conexiones"] = json!([]);
            value["vehiculosActuales"] = json!(0);
            self.buildings[building].set_parking_fields(&value);
        }
        self.sync_parking_buildings();
        Ok(())
    }

    pub(super) fn sync_parking_buildings(&mut self) {
        for i in 0..self.buildings.len() {
            let mut value = self.buildings[i].parking_fields();
            if self.model.parking(i).is_none()
                && value["conexiones"]
                    .as_array()
                    .is_some_and(|rows| !rows.is_empty())
            {
                value["esEstacionamiento"] = json!(false);
                value["conexiones"] = json!([]);
                value["vehiculosActuales"] = json!(0);
            }
            let value = self.parking_json(i, value);
            self.buildings[i].set_parking_fields(&value);
            self.data["edificios"][i]
                .as_object_mut()
                .expect("building object")
                .extend(value.as_object().expect("parking object").clone());
        }
    }

    pub(super) fn parking_json(&self, building: usize, mut value: Value) -> Value {
        let Some(parking) = self.model.parking(building) else {
            return value;
        };
        value["vehiculosActuales"] = json!(0);
        value["esEstacionamiento"] = json!(true);
        value["capacidadMaxima"] = json!(parking.config.capacity);
        value["probabilidadesEntrada"] = json!(parking.config.entry_probabilities);
        value["probabilidadesSalida"] = json!(parking.config.exit_probabilities);
        value["conexiones"] = Value::Array(parking.config.pairs.iter().flat_map(|pair| {
            [(pair.entrance, "entrada"), (pair.exit, "salida")].map(|(cell, kind)| {
                let road = &self.data["calles"][cell.street];
                let id = road.get("id").filter(|v| !v.is_null()).cloned().unwrap_or_else(|| json!(self.layout[cell.street].name));
                json!({"tipo": kind, "calleId": id, "calleIdx": cell.street, "carril": cell.lane, "indice": cell.index})
            })
        }).collect());
        value
    }

    pub(super) fn read_parking(
        &self,
        value: &Value,
    ) -> Result<Option<ParkingConfig>, BuildingError> {
        if value["esEstacionamiento"] != true {
            return Ok(None);
        }
        let invalid = || BuildingError("parking.validation.incompletePair");
        let rows = value["conexiones"].as_array().ok_or_else(invalid)?;
        // Older artwork-only maps can carry the flag without functional pairs.
        if rows.is_empty() {
            return Ok(None);
        }
        let mut entrances = Vec::new();
        let mut exits = Vec::new();
        for row in rows {
            let street = if let Some(index) = row.get("calleIdx") {
                integer(index).map_err(|_| invalid())?
            } else {
                self.data["calles"]
                    .as_array()
                    .expect("roads")
                    .iter()
                    .position(|road| {
                        road.get("id").is_some_and(|id| id == &row["calleId"])
                            || road
                                .get("nombre")
                                .is_some_and(|name| name == &row["calleId"])
                    })
                    .ok_or_else(invalid)?
            };
            let cell = CellRef {
                street,
                lane: integer(&row["carril"]).map_err(|_| invalid())?,
                index: integer(&row["indice"]).map_err(|_| invalid())?,
            };
            match row["tipo"].as_str() {
                Some("entrada") => entrances.push(cell),
                Some("salida") => exits.push(cell),
                _ => return Err(invalid()),
            }
        }
        if entrances.len() != exits.len() {
            return Err(invalid());
        }
        let mut config = ParkingConfig::new(
            integer(&value["capacidadMaxima"])
                .map_err(|_| BuildingError("parking.validation.capacityPositive"))?,
            entrances
                .into_iter()
                .zip(exits)
                .map(|(entrance, exit)| ParkingPair { entrance, exit })
                .collect(),
        );
        for (key, target) in [
            ("probabilidadesEntrada", &mut config.entry_probabilities),
            ("probabilidadesSalida", &mut config.exit_probabilities),
        ] {
            if let Some(values) = value.get(key) {
                let values = values
                    .as_array()
                    .filter(|v| v.len() == 24)
                    .ok_or_else(invalid)?;
                for (target, value) in target.iter_mut().zip(values) {
                    *target = value.as_f64().ok_or_else(invalid)?;
                }
            }
        }
        Ok(Some(config))
    }
}
