//! v1 map configuration codec. Validate a complete candidate before replacement.
//! Unowned fields stay in the document for later feature ports.
use serde_json::{Value, json};

use crate::cell_index::StreetGeometry;
use crate::connections::{Connection, Mapping, MergeRow, WeightedRow};
use crate::geometry::{Vertex, initialize_vertices};
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
    zones: Vec<BackgroundZone>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BackgroundZone {
    /// Polygon points in cell-sized world units. Rectangles use four points.
    pub points: Vec<[f32; 2]>,
    pub color: [u8; 4],
    pub label: String,
    pub show_label: bool,
    pub show_border: bool,
}

pub struct MapGeometry {
    pub streets: Vec<StreetGeometry>,
    pub axes: Vec<Vec<Vec<[f32; 2]>>>,
}

impl MapGeometry {
    pub fn translate(&mut self, shift: [f32; 2]) {
        for center in self
            .streets
            .iter_mut()
            .flat_map(|s| &mut s.centers)
            .flatten()
        {
            for i in 0..2 {
                center[i] += shift[i];
            }
        }
    }
}

/// Display metadata in cell-sized world units, in the model's street order.
#[derive(Clone, Debug)]
pub struct StreetPlacement {
    pub name: String,
    pub origin: [f64; 2],
    pub angle_degrees: f64,
    pub curved: bool,
    pub vertices: Vec<Vertex>,
}

impl MapDocument {
    /// Shared topology cleanup. Later feature ports extend this boundary.
    pub fn delete_street(&mut self, street: usize) -> bool {
        if !self.model.delete_street(street) {
            return false;
        }
        self.layout.remove(street);
        self.data["calles"]
            .as_array_mut()
            .expect("validated roads")
            .remove(street);
        let links = self.data["conexiones"]
            .as_array_mut()
            .expect("validated links");
        links.retain(|link| {
            link["origenIdx"].as_u64() != Some(street as u64)
                && link["destinoIdx"].as_u64() != Some(street as u64)
        });
        for link in links {
            for key in ["origenIdx", "destinoIdx"] {
                let index = link[key].as_u64().expect("validated index");
                link[key] = json!(index - u64::from(index > street as u64));
            }
        }
        true
    }

    pub fn edit_streets(
        &mut self,
        edit: crate::streets::StreetEdit,
    ) -> Result<crate::streets::StreetEvent, MapError> {
        use crate::streets::StreetEvent;
        match edit {
            crate::streets::StreetEdit::Draw(draft) => {
                Ok(StreetEvent::Drawn(self.draw_street(draft)?))
            }
            crate::streets::StreetEdit::Delete(street) => {
                if !self.delete_street(street) {
                    return Err(MapError);
                }
                Ok(StreetEvent::Deleted(street))
            }
        }
    }

    pub fn validate_street_edit(&self, edit: crate::streets::StreetEdit) -> Result<(), MapError> {
        match edit {
            crate::streets::StreetEdit::Draw(draft) => {
                self.new_street(draft)?;
            }
            crate::streets::StreetEdit::Delete(street) => {
                if street >= self.layout.len() {
                    return Err(MapError);
                }
            }
        }
        Ok(())
    }

    fn new_street(&self, draft: crate::streets::StreetDraft) -> Result<Self, MapError> {
        let total: usize = self.model.streets().iter().map(|s| s.cells().len()).sum();
        if total.saturating_add(draft.cells) > 1_000_000 {
            return Err(MapError);
        }
        let mut n = 1;
        while self.layout.iter().any(|p| p.name == format!("Street {n}")) {
            n += 1;
        }
        // Reuse the file validator for this street only, never reparse the map.
        Self::parse(
            &json!({"calles": [{
                "nombre": format!("Street {n}"), "tipo": "conexion",
                "tamano": draft.cells, "carriles": 1,
                "x": draft.origin[0] * 5.0, "y": draft.origin[1] * 5.0,
                "angulo": draft.angle_degrees, "probabilidadSaltoDeCarril": 0.02
            }]})
            .to_string(),
        )
    }

    pub fn draw_street(&mut self, draft: crate::streets::StreetDraft) -> Result<usize, MapError> {
        let mut candidate = self.new_street(draft)?;
        let id = self.layout.len();
        self.model.add_street(candidate.model.streets()[0].clone());
        self.layout.push(candidate.layout.remove(0));
        self.data["calles"]
            .as_array_mut()
            .expect("validated roads")
            .push(candidate.data["calles"][0].take());
        Ok(id)
    }

    pub fn campus() -> Self {
        Self::parse(include_str!("campus.json")).expect("exported v1 campus")
    }

    pub fn geometry(&self) -> Vec<StreetGeometry> {
        self.geometry_snapshot().streets
    }

    pub fn axes(&self) -> Vec<Vec<Vec<[f32; 2]>>> {
        self.geometry_snapshot().axes
    }

    pub fn geometry_snapshot(&self) -> MapGeometry {
        let mut streets = Vec::with_capacity(self.layout.len());
        let mut axes = Vec::with_capacity(self.layout.len());
        for (id, (p, s)) in self.layout.iter().zip(self.model.streets()).enumerate() {
            let geometry = p.cells(s.config().carriles, s.config().tamano);
            streets.push(StreetGeometry {
                id,
                centers: geometry.centers,
            });
            axes.push(geometry.axes);
        }
        MapGeometry { streets, axes }
    }

    pub fn zones(&self) -> &[BackgroundZone] {
        &self.zones
    }

    /// A geometry edit changes configuration, not traffic or connections.
    pub fn set_vertex_offset(&mut self, street: usize, vertex: usize, offset: f64) -> bool {
        let Some(placement) = self.layout.get_mut(street) else {
            return false;
        };
        if !placement.set_vertex_offset(vertex, offset) {
            return false;
        }
        self.data["calles"][street]["esCurva"] = json!(true);
        self.data["calles"][street]["vertices"] = json!(
            placement
                .vertices
                .iter()
                .map(|v| json!({"indiceCelda":v.index,"anguloOffset":v.offset}))
                .collect::<Vec<_>>()
        );
        true
    }
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
                origin: [number(&road["x"])? / 5.0, number(&road["y"])? / 5.0],
                angle_degrees: number(&road["angulo"])?,
                curved: road["esCurva"].as_bool().ok_or(MapError)?,
                vertices: {
                    let saved = road["vertices"].as_array().ok_or(MapError)?;
                    if saved.len() > 2501 {
                        return Err(MapError);
                    }
                    let vertices: Vec<_> = saved
                        .iter()
                        .map(|v| {
                            let index = integer(&v["indiceCelda"])?;
                            let offset = number(&v["anguloOffset"])?;
                            // V1 retains vertices beyond the end after a street resize.
                            if index > 2500 || offset.abs() > 90.0 {
                                return Err(MapError);
                            }
                            Ok(Vertex { index, offset })
                        })
                        .collect::<Result<_, _>>()?;
                    if vertices.windows(2).any(|v| v[0].index >= v[1].index) {
                        return Err(MapError);
                    }
                    if vertices.is_empty()
                        && tipo == CalleType::Conexion
                        && road.get("geometryType").is_none()
                        && road.get("bezierControls").is_none()
                    {
                        initialize_vertices(length)
                    } else {
                        vertices
                    }
                },
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
        let zones = parse_zones(root.get("backgroundAreas"))?;
        Ok(Self {
            data,
            model,
            layout,
            zones,
        })
    }

    pub fn model(&self) -> &TrafficModel {
        &self.model
    }
    /// Live traffic access. Structural edits must use the document edit boundary.
    pub fn model_mut(&mut self) -> &mut TrafficModel {
        &mut self.model
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

fn parse_zones(value: Option<&Value>) -> Result<Vec<BackgroundZone>, MapError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let areas = value.as_array().ok_or(MapError)?;
    if areas.len() > 10000 {
        return Err(MapError);
    }
    areas
        .iter()
        .map(|area| {
            let coordinate = |v: &Value| -> Result<f32, MapError> {
                let n = number(v)?;
                if n.abs() > 1_000_000.0 {
                    return Err(MapError);
                }
                Ok((n / 5.0) as f32)
            };
            let points = if let Some(vertices) = area.get("vertices") {
                let vertices = vertices.as_array().ok_or(MapError)?;
                if !(3..=10000).contains(&vertices.len()) {
                    return Err(MapError);
                }
                vertices
                    .iter()
                    .map(|v| Ok([coordinate(&v["x"])?, coordinate(&v["y"])?]))
                    .collect::<Result<Vec<_>, MapError>>()?
            } else {
                let x = coordinate(&area["x"])?;
                let y = coordinate(&area["y"])?;
                let w = coordinate(&area["width"])?;
                let h = coordinate(&area["height"])?;
                if w <= 0.0 || h <= 0.0 {
                    return Err(MapError);
                }
                vec![[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
            };
            let color = area["color"].as_str().ok_or(MapError)?;
            if !color.starts_with('#')
                || ![7, 9].contains(&color.len())
                || !color[1..].bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err(MapError);
            }
            let mut rgba = [255; 4];
            for (i, channel) in rgba.iter_mut().enumerate().take((color.len() - 1) / 2) {
                *channel =
                    u8::from_str_radix(&color[1 + i * 2..3 + i * 2], 16).map_err(|_| MapError)?;
            }
            let alpha = area.get("alpha").map(number).transpose()?.unwrap_or(0.3);
            if !(0.0..=1.0).contains(&alpha) {
                return Err(MapError);
            }
            rgba[3] = (rgba[3] as f64 * alpha).round() as u8;
            Ok(BackgroundZone {
                points,
                color: rgba,
                label: area
                    .get("label")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned(),
                show_label: area["showLabel"] != false,
                show_border: area["showBorder"] == true,
            })
        })
        .collect()
}
