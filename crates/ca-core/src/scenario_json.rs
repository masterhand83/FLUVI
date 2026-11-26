//! Portable v1 scenario files. Validate the whole candidate before changing cells.
use crate::{
    cell_index::CellRef,
    disruptions::{Disruption, ScenarioAction},
    map_json::MapDocument,
};
use serde_json::{Value, json};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq)]
pub struct Scenario(Value);

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct ScenarioError(pub &'static str);

impl ScenarioError {
    pub fn translation_key(self) -> &'static str {
        self.0
    }
}

fn invalid() -> ScenarioError {
    ScenarioError("scenarios.invalidFile")
}
fn index(value: &Value) -> Result<usize, ScenarioError> {
    value
        .as_u64()
        .and_then(|n| usize::try_from(n).ok())
        .ok_or_else(invalid)
}

pub fn rain_probability(value: &Value) -> Result<f64, ScenarioError> {
    match value.get("probabilidad") {
        None => Ok(0.1),
        Some(value) => value
            .as_f64()
            .filter(|p| (0.0..=100.0).contains(p))
            .map(|p| p / 100.)
            .ok_or_else(invalid),
    }
}

fn mark(value: &Value) -> Result<Disruption, ScenarioError> {
    match (value["tipo"].as_str(), value["texture"].as_str()) {
        (Some("bloqueo"), _) => Ok(Disruption::LaneBlock),
        (Some("inundacion"), _) => Ok(Disruption::Flood),
        (Some("obstaculo"), Some("bache")) => Ok(Disruption::Pothole),
        (Some("obstaculo"), Some("trabajador" | "obrero")) => Ok(Disruption::Worker),
        (Some("obstaculo"), Some("arbol")) => Ok(Disruption::Tree),
        (Some("obstaculo"), Some("cono")) => Ok(Disruption::Cone),
        _ => Err(invalid()),
    }
}

impl Scenario {
    pub fn parse(text: &str) -> Result<Self, ScenarioError> {
        Self::from_value(serde_json::from_str(text).map_err(|_| invalid())?)
    }

    pub fn from_value(mut value: Value) -> Result<Self, ScenarioError> {
        if value["nombre"].as_str().is_none_or(|s| s.trim().is_empty())
            || value["id"].as_str().is_none_or(str::is_empty)
        {
            return Err(invalid());
        }
        for road in value["callesConfig"].as_array().ok_or_else(invalid)? {
            if road["nombre"].as_str().is_none()
                || index(&road["tamano"])? == 0
                || index(&road["carriles"])? == 0
            {
                return Err(invalid());
            }
        }
        for cell in value["celdasBloqueadas"].as_array().ok_or_else(invalid)? {
            index(&cell["carril"])?;
            index(&cell["indice"])?;
            mark(cell)?;
        }
        let probability = rain_probability(&value["lluviaAleatoria"])?;
        value["lluviaAleatoria"] = json!({"probabilidad": probability * 100.});
        let object = value.as_object_mut().ok_or_else(invalid)?;
        object.remove("language");
        object.remove("idioma");
        object.remove("interfaceLanguage");
        Ok(Self(value))
    }

    pub fn name(&self) -> &str {
        self.0["nombre"].as_str().expect("validated name")
    }
    pub fn id(&self) -> &str {
        self.0["id"].as_str().expect("validated id")
    }
    pub fn probability(&self) -> f64 {
        rain_probability(&self.0["lluviaAleatoria"]).expect("validated rain")
    }
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(&self.0).expect("scenario JSON")
    }
    pub fn to_value(&self) -> Value {
        self.0.clone()
    }

    fn cells(&self, map: &MapDocument) -> Result<Vec<(CellRef, Disruption)>, ScenarioError> {
        let mismatch = || ScenarioError("scenarios.layoutMismatch");
        let find = |id: &Value, name: &Value| {
            map.layout()
                .iter()
                .enumerate()
                .position(|(i, road)| {
                    id.as_str().is_some_and(|id| id == map.street_id(i))
                        || name.as_str() == Some(road.name.as_str())
                })
                .ok_or_else(mismatch)
        };
        let mut roads = HashSet::new();
        if self.0["callesConfig"]
            .as_array()
            .expect("validated roads")
            .len()
            != map.layout().len()
        {
            return Err(mismatch());
        }
        for road in self.0["callesConfig"].as_array().expect("validated roads") {
            let street = find(&road["id"], &road["nombre"])?;
            let config = map.model().streets()[street].config();
            if !roads.insert(street)
                || config.tamano != index(&road["tamano"])?
                || config.carriles != index(&road["carriles"])?
            {
                return Err(mismatch());
            }
        }
        let mut seen = HashSet::new();
        let mut cells = Vec::new();
        for value in self.0["celdasBloqueadas"]
            .as_array()
            .expect("validated cells")
        {
            let street = find(&value["calleId"], &value["calleNombre"])?;
            let lane = index(&value["carril"])?;
            let index = index(&value["indice"])?;
            let config = map.model().streets()[street].config();
            if !roads.contains(&street)
                || lane >= config.carriles
                || index >= config.tamano
                || !seen.insert((street, lane, index))
            {
                return Err(mismatch());
            }
            cells.push((
                CellRef {
                    street,
                    lane,
                    index,
                },
                mark(value)?,
            ));
        }
        Ok(cells)
    }

    pub fn validate(&self, map: &MapDocument) -> Result<(), ScenarioError> {
        self.cells(map).map(|_| ())
    }
}

impl MapDocument {
    pub fn capture_scenario(&self, name: &str, id: &str) -> Result<Scenario, ScenarioError> {
        let roads: Vec<_> = self
            .layout()
            .iter()
            .enumerate()
            .map(|(i, road)| {
                let config = self.model().streets()[i].config();
                json!({"id":self.street_id(i), "nombre":road.name,
                "tamano":config.tamano, "carriles":config.carriles})
            })
            .collect();
        let mut cells = Vec::new();
        let mut counts = [0; 3];
        for (street, road) in self.model().streets().iter().enumerate() {
            for lane in 0..road.config().carriles {
                for index in 0..road.config().tamano {
                    let Some(mark) = self.model().disruption(CellRef {
                        street,
                        lane,
                        index,
                    }) else {
                        continue;
                    };
                    let (kind, texture, count) = match mark {
                        Disruption::LaneBlock => ("bloqueo", None, 0),
                        Disruption::Flood => ("inundacion", Some("inundacion"), 1),
                        Disruption::Pothole => ("obstaculo", Some("bache"), 2),
                        Disruption::Worker => ("obstaculo", Some("trabajador"), 2),
                        Disruption::Tree => ("obstaculo", Some("arbol"), 2),
                        Disruption::Cone => ("obstaculo", Some("cono"), 2),
                    };
                    counts[count] += 1;
                    cells.push(json!({"calleNombre":self.layout()[street].name,
                        "calleId":self.street_id(street), "carril":lane,"indice":index,
                        "tipo":kind,"texture":texture}));
                }
            }
        }
        Scenario::from_value(json!({"version":"1.0","id":id,"nombre":name.trim(),
            "descripcion":"","callesConfig":roads,"celdasBloqueadas":cells,
            "lluviaAleatoria":{"probabilidad":self.model().rain().1 * 100.},
            "estadisticas":{"totalBloqueos":counts[0],"totalInundaciones":counts[1],
                "totalObstaculos":counts[2]}}))
    }

    pub fn load_scenario(&mut self, scenario: &Scenario) -> Result<(), ScenarioError> {
        let cells = scenario.cells(self)?;
        self.model_mut()
            .disrupt(ScenarioAction::Clear)
            .expect("clear");
        for (cell, mark) in cells {
            // Loading replaces vehicles at saved marks, just as v1 does.
            self.model_mut().set_scenario_cell(cell, mark);
        }
        self.model_mut()
            .set_rain(false, scenario.probability())
            .expect("validated rain");
        Ok(())
    }
}
