//! v1 map configuration codec. Validate a complete candidate before replacement.
//! Unowned fields stay in the document for later feature ports.
use serde_json::{Value, json};

use crate::connections::{Connection, Mapping, MergeRow, WeightedRow};
use crate::traffic::{Calle, CalleConfig, CalleType, LaneDirection, TrafficModel};

#[derive(Debug, thiserror::Error)]
#[error("invalid map JSON")]
pub struct MapError;

impl MapError {
    pub fn translation_key(&self) -> &'static str {
        "mapFiles.invalidFile"
    }
}

#[derive(Clone, Debug)]
pub struct MapDocument {
    data: Value,
    model: TrafficModel,
    layout: Vec<StreetPlacement>,
}

/// Display metadata in cell-sized world units, in the model's street order.
#[derive(Clone, Debug)]
pub struct StreetPlacement {
    pub name: String,
    pub origin: [f32; 2],
    pub angle_radians: f32,
}

impl MapDocument {
    pub fn demo() -> Self {
        let model = TrafficModel::demo();
        let roads: Vec<_> = model.streets().iter().enumerate().map(|(i, street)| {
            let c = street.config();
            json!({
                "nombre": (["Generador", "Conexion", "Devorador"][i]),
                "tamano": c.tamano, "carriles": c.carriles,
                "tipo": match c.tipo { CalleType::Generador => "generador", CalleType::Conexion => "conexion", CalleType::Devorador => "devorador" },
                "x": 10, "y": 10 + i * 20, "angulo": 0,
                "probabilidadGeneracion": c.generation_probability,
                "probabilidadSaltoDeCarril": c.lane_change_probability,
                "laneDirections": [1, -1]
            })
        }).collect();
        let links: Vec<_> = model.connections().iter().flat_map(Connection::mappings).map(|m| json!({
            "origenIdx": m.source_street, "destinoIdx": m.destination_street, "tipo": "LINEAL",
            "detalles": [{"carrilOrigen": m.source_lane, "carrilDestino": m.destination_lane,
                "posOrigen": m.source_cell, "posDestino": m.destination_cell, "probabilidad": 1.0}]
        })).collect();
        let mut document = Self::parse(&json!({"version": "1.0", "nombre": "Demo", "calles": roads, "conexiones": links, "edificios": []}).to_string()).expect("demo map");
        // The demo alone starts with seeded traffic. Map files omit vehicles.
        document.model = model;
        document
    }

    pub fn empty() -> Self {
        Self::parse(r#"{"version":"1.0","nombre":"","calles":[],"conexiones":[],"edificios":[]}"#)
            .expect("empty map")
    }

    pub fn parse(text: &str) -> Result<Self, MapError> {
        let mut data: Value = serde_json::from_str(text).map_err(|_| MapError)?;
        let root = data.as_object_mut().ok_or(MapError)?;
        // Language belongs to the app preferences, never to a map.
        for key in ["language", "idioma", "interfaceLanguage"] {
            root.remove(key);
        }
        root.entry("version").or_insert(json!("1.0"));
        root.entry("nombre").or_insert(json!(""));
        if !root["nombre"].is_string() {
            return Err(MapError);
        }
        let roads = root
            .get_mut("calles")
            .and_then(Value::as_array_mut)
            .ok_or(MapError)?;
        let mut streets = Vec::with_capacity(roads.len());
        let mut layout = Vec::with_capacity(roads.len());
        let mut total_cells = 0usize;
        for road in roads {
            let object = road.as_object_mut().ok_or(MapError)?;
            for (key, default) in [
                ("carriles", json!(1)),
                ("angulo", json!(0)),
                ("x", json!(0)),
                ("y", json!(0)),
                ("probabilidadGeneracion", json!(0)),
                ("probabilidadSaltoDeCarril", json!(0.05)),
                ("vertices", json!([])),
                ("esCurva", json!(false)),
            ] {
                object.entry(key).or_insert(default);
            }
            if !road["nombre"].is_string() {
                return Err(MapError);
            }
            let lanes = integer(&road["carriles"])?;
            let length = integer(&road["tamano"])?;
            if !(1..=10).contains(&lanes) || !(1..=2500).contains(&length) {
                return Err(MapError);
            }
            total_cells += lanes * length;
            // Bound allocation from untrusted input (before allocating cell buffers).
            if total_cells > 1_000_000 {
                return Err(MapError);
            }
            for key in ["x", "y", "angulo"] {
                let n = number(&road[key])?;
                if n.abs() > 1_000_000.0 {
                    return Err(MapError);
                }
            }
            let tipo = match road["tipo"]
                .as_str()
                .ok_or(MapError)?
                .to_lowercase()
                .as_str()
            {
                "generador" => CalleType::Generador,
                "conexion" => CalleType::Conexion,
                "devorador" => CalleType::Devorador,
                _ => return Err(MapError),
            };
            layout.push(StreetPlacement {
                name: road["nombre"].as_str().ok_or(MapError)?.to_owned(),
                origin: [
                    (number(&road["x"])? / 5.0) as f32,
                    (number(&road["y"])? / 5.0) as f32,
                ],
                angle_radians: number(&road["angulo"])?.to_radians() as f32,
            });
            let mut config = CalleConfig::new(lanes, length, tipo);
            config.generation_probability = number(&road["probabilidadGeneracion"])?;
            config.lane_change_probability = number(&road["probabilidadSaltoDeCarril"])?;
            // Match v1: only -1 reverses a lane, only false disables generation.
            config.lane_directions = (0..lanes)
                .map(|i| {
                    Some(if road["laneDirections"][i].as_f64() == Some(-1.0) {
                        LaneDirection::Reverse
                    } else {
                        LaneDirection::Forward
                    })
                })
                .collect();
            config.lane_generation_enabled = (0..lanes)
                .map(|i| Some(road["laneGenerationEnabled"][i] != false))
                .collect();
            road["laneDirections"] = json!(
                config
                    .lane_directions
                    .iter()
                    .map(|d| if *d == Some(LaneDirection::Reverse) {
                        -1
                    } else {
                        1
                    })
                    .collect::<Vec<_>>()
            );
            road["laneGenerationEnabled"] = json!(config.lane_generation_enabled);
            streets.push(Calle::new(config, vec![0; lanes * length]).map_err(|_| MapError)?);
        }
        let mut model = TrafficModel::new(streets, 42);
        let links = root
            .entry("conexiones")
            .or_insert(json!([]))
            .as_array_mut()
            .ok_or(MapError)?;
        let mut connections = Vec::new();
        for link in links {
            let source = integer(&link["origenIdx"])?;
            let destination = integer(&link["destinoIdx"])?;
            let kind = link["tipo"].as_str().ok_or(MapError)?.to_owned();
            let details = link["detalles"].as_array_mut().ok_or(MapError)?;
            if details.is_empty() {
                return Err(MapError);
            }
            let mut merge = Vec::new();
            for detail in details {
                let object = detail.as_object_mut().ok_or(MapError)?;
                object.entry("posOrigen").or_insert(json!(-1));
                object.entry("posDestino").or_insert(json!(0));
                object.entry("probabilidad").or_insert(json!(1.0));
                let mapping = Mapping {
                    source_street: source,
                    destination_street: destination,
                    source_lane: integer(&detail["carrilOrigen"])?,
                    destination_lane: integer(&detail["carrilDestino"])?,
                    source_cell: detail["posOrigen"]
                        .as_i64()
                        .and_then(|v| isize::try_from(v).ok())
                        .ok_or(MapError)?,
                    destination_cell: integer(&detail["posDestino"])?,
                };
                let weight = number(&detail["probabilidad"])?;
                if !(0.0..=1.0).contains(&weight) {
                    return Err(MapError);
                }
                match kind.as_str() {
                    "LINEAL" => connections.push(Connection::Lineal(mapping)),
                    "INCORPORACION" => merge.push(MergeRow {
                        mapping,
                        enabled: detail["enabled"] != false,
                    }),
                    "PROBABILISTICA" => {
                        connections.push(Connection::ProbabilityTrial(WeightedRow {
                            mapping,
                            weight,
                        }))
                    }
                    _ => return Err(MapError),
                }
            }
            if !merge.is_empty() {
                connections.push(Connection::Incorporacion(merge));
            }
        }
        for connection in connections {
            model.add_connection(connection).map_err(|_| MapError)?;
        }
        Ok(Self {
            data,
            model,
            layout,
        })
    }

    pub fn model(&self) -> &TrafficModel {
        &self.model
    }
    pub fn name(&self) -> &str {
        self.data["nombre"].as_str().expect("validated name")
    }
    pub fn layout(&self) -> &[StreetPlacement] {
        &self.layout
    }
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(&self.data).expect("validated map")
    }
}

fn integer(value: &Value) -> Result<usize, MapError> {
    value
        .as_u64()
        .and_then(|n| usize::try_from(n).ok())
        .ok_or(MapError)
}
fn number(value: &Value) -> Result<f64, MapError> {
    value.as_f64().filter(|n| n.is_finite()).ok_or(MapError)
}
