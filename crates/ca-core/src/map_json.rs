//! v1 map configuration codec. Validate a complete candidate before replacement.
//! Unowned fields stay in the document for later feature ports.
use serde_json::{Value, json};

use crate::cell_index::StreetGeometry;
use crate::connections::{Connection, Mapping, MergeRow, WeightedRow};
use crate::geometry::{Vertex, initialize_vertices};
use crate::streets::{StreetChange, StreetError};
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
    buildings: Vec<crate::buildings::Building>,
    time: Box<crate::virtual_time::VirtualTime>,
    edit_session: Option<Box<StreetSnapshot>>,
    data: Value,
    model: TrafficModel,
    layout: Vec<StreetPlacement>,
    zones: Vec<BackgroundZone>,
}

#[derive(Clone, Debug)]
struct StreetSnapshot {
    street: usize,
    placement: StreetPlacement,
    road: Value,
    traffic: Calle,
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
    pub bezier: Option<crate::bezier::BezierCurve>,
    pub name: String,
    pub origin: [f64; 2],
    pub angle_degrees: f64,
    pub curved: bool,
    pub vertices: Vec<Vertex>,
    pub roundabout: Option<crate::streets::RoundaboutDraft>,
}

impl MapDocument {
    pub fn validate_building_edit(
        &self,
        edit: &crate::buildings::BuildingEdit,
    ) -> Result<(), crate::buildings::BuildingError> {
        use crate::buildings::{BuildingEdit, BuildingError};
        match edit {
            BuildingEdit::Create(building) => building.validate(),
            BuildingEdit::Update(index, building) => {
                self.buildings.get(*index).ok_or(BuildingError("missing"))?;
                building.validate()
            }
            BuildingEdit::Delete(index) => self
                .buildings
                .get(*index)
                .map(|_| ())
                .ok_or(BuildingError("missing")),
        }
    }
    pub fn edit_buildings(
        &mut self,
        edit: crate::buildings::BuildingEdit,
    ) -> Result<Option<usize>, crate::buildings::BuildingError> {
        use crate::buildings::{BuildingEdit, BuildingError};
        match edit {
            BuildingEdit::Create(building) => self.add_building(building).map(Some),
            BuildingEdit::Update(index, building) => {
                self.update_building(index, building).map(|()| Some(index))
            }
            BuildingEdit::Delete(index) => {
                if self.delete_building(index) {
                    Ok(None)
                } else {
                    Err(BuildingError("missing"))
                }
            }
        }
    }
    pub fn buildings(&self) -> &[crate::buildings::Building] {
        &self.buildings
    }

    pub fn add_building(
        &mut self,
        building: crate::buildings::Building,
    ) -> Result<usize, crate::buildings::BuildingError> {
        building.validate()?;
        let index = self.buildings.len();
        if !self.data["edificios"].is_array() {
            self.data["edificios"] = json!([]);
        }
        self.data["edificios"]
            .as_array_mut()
            .expect("array")
            .push(building.to_json());
        self.buildings.push(building);
        Ok(index)
    }

    pub fn update_building(
        &mut self,
        index: usize,
        building: crate::buildings::Building,
    ) -> Result<(), crate::buildings::BuildingError> {
        building.validate()?;
        let target = self
            .buildings
            .get_mut(index)
            .ok_or(crate::buildings::BuildingError("missing"))?;
        self.data["edificios"][index] = building.to_json();
        *target = building;
        Ok(())
    }

    /// Shared cleanup boundary. Parking release is added here by ticket 21.
    pub fn delete_building(&mut self, index: usize) -> bool {
        if index >= self.buildings.len() {
            return false;
        }
        self.buildings.remove(index);
        self.data["edificios"]
            .as_array_mut()
            .expect("buildings")
            .remove(index);
        true
    }

    pub fn editing_street(&self) -> Option<usize> {
        self.edit_session.as_ref().map(|s| s.street)
    }
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
    ) -> Result<crate::streets::StreetEvent, StreetError> {
        use crate::streets::StreetEvent;
        let curve = self.prepare_street_edit(&edit)?;
        match edit {
            crate::streets::StreetEdit::Create(definition) => {
                let candidate = self
                    .street_from_definition(&definition)
                    .map_err(|_| StreetError("streetDrawing.invalid"))?;
                Ok(StreetEvent::Drawn(self.insert_street(candidate)))
            }
            crate::streets::StreetEdit::BeginSession(street) => {
                self.edit_session = Some(Box::new(StreetSnapshot {
                    street,
                    placement: self.layout[street].clone(),
                    road: self.data["calles"][street].clone(),
                    traffic: self.model.streets()[street].clone(),
                }));
                Ok(StreetEvent::Updated(street))
            }
            crate::streets::StreetEdit::SaveSession => {
                let snapshot = self.edit_session.take().expect("validated session");
                Ok(StreetEvent::Updated(snapshot.street))
            }
            crate::streets::StreetEdit::CancelSession => {
                let snapshot = self.edit_session.take().expect("validated session");
                self.layout[snapshot.street] = snapshot.placement;
                self.data["calles"][snapshot.street] = snapshot.road;
                self.model.restore_street(snapshot.street, snapshot.traffic);
                Ok(StreetEvent::Updated(snapshot.street))
            }
            crate::streets::StreetEdit::Bulk {
                mut streets,
                lanes,
                directions,
            } => {
                let mut candidate = self.clone();
                // Shrink first so a valid final cell budget is also valid at each step.
                streets.sort_by_key(|&id| {
                    std::cmp::Reverse(self.model.streets()[id].config().carriles)
                });
                for street in streets {
                    let length = self.model.streets()[street].config().tamano;
                    candidate.edit_streets(crate::streets::StreetEdit::Update(
                        street,
                        StreetChange::Dimensions { lanes, length },
                    ))?;
                    for (lane, direction) in directions.iter().copied().enumerate() {
                        candidate.edit_streets(crate::streets::StreetEdit::Update(
                            street,
                            StreetChange::Direction { lane, direction },
                        ))?;
                    }
                }
                *self = candidate;
                Ok(StreetEvent::BulkUpdated)
            }
            crate::streets::StreetEdit::DrawRoundabout(draft) => {
                let candidate = self.new_roundabout(draft)?;
                Ok(StreetEvent::Drawn(self.insert_street(candidate)))
            }
            crate::streets::StreetEdit::Draw(draft) => Ok(StreetEvent::Drawn(
                self.draw_street(draft)
                    .map_err(|_| StreetError("streetDrawing.invalid"))?,
            )),
            crate::streets::StreetEdit::Delete(street) => {
                if !self.delete_street(street) {
                    return Err(StreetError("streetDrawing.invalid"));
                }
                Ok(StreetEvent::Deleted(street))
            }
            crate::streets::StreetEdit::Update(street, change) => {
                match change {
                    StreetChange::StraightGeometry {
                        origin,
                        angle,
                        length,
                    } => {
                        let lanes = self.model.streets()[street].config().carriles;
                        self.reconcile_dimensions(street, lanes, length);
                        self.layout[street].origin = origin;
                        self.layout[street].angle_degrees = angle;
                        let road = &mut self.data["calles"][street];
                        road["x"] = json!(origin[0] * 5.0);
                        road["y"] = json!(origin[1] * 5.0);
                        road["angulo"] = json!(angle);
                    }
                    StreetChange::Bezier(_) => {}
                    StreetChange::Radius(radius) => {
                        let mut ring = self.layout[street].roundabout.expect("validated ring");
                        ring.inner_radius = radius;
                        self.reconcile_dimensions(
                            street,
                            self.model.streets()[street].config().carriles,
                            ring.cells(),
                        );
                        self.layout[street].roundabout = Some(ring);
                        self.data["calles"][street]["innerRadius"] = json!(radius * 5.0);
                    }
                    crate::streets::StreetChange::Dimensions { lanes, length } => {
                        self.reconcile_dimensions(street, lanes, length);
                    }
                    crate::streets::StreetChange::Direction { lane, direction } => {
                        self.model.street_config_mut(street).lane_directions[lane] =
                            Some(direction);
                        self.data["calles"][street]["laneDirections"][lane] =
                            json!(if direction == LaneDirection::Reverse {
                                -1
                            } else {
                                1
                            });
                        return Ok(StreetEvent::LaneDirectionsChanged(street));
                    }
                    StreetChange::Name(name) => {
                        self.data["calles"][street]["nombre"] = json!(name);
                        self.layout[street].name = name;
                    }
                    StreetChange::Origin(origin) => {
                        if let Some(ring) = &mut self.layout[street].roundabout {
                            ring.center = origin;
                        }
                        self.layout[street].origin = origin;
                        self.data["calles"][street]["x"] = json!(origin[0] * 5.0);
                        self.data["calles"][street]["y"] = json!(origin[1] * 5.0);
                    }
                    StreetChange::Angle(angle) => {
                        if let Some(ring) = &mut self.layout[street].roundabout {
                            ring.start_angle = angle;
                            self.data["calles"][street]["startAngle"] = json!(angle);
                        }
                        self.layout[street].angle_degrees = angle;
                        self.data["calles"][street]["angulo"] = json!(angle);
                    }
                    StreetChange::Type(tipo) => {
                        self.model.street_config_mut(street).tipo = tipo;
                        self.data["calles"][street]["tipo"] = json!(match tipo {
                            CalleType::Generador => "generador",
                            CalleType::Conexion => "conexion",
                            CalleType::Devorador => "devorador",
                        });
                    }
                    StreetChange::Generation(value) => {
                        self.model.street_config_mut(street).generation_probability = value;
                        self.data["calles"][street]["probabilidadGeneracion"] = json!(value);
                    }
                    StreetChange::LaneChange(value) => {
                        self.model.street_config_mut(street).lane_change_probability = value;
                        self.data["calles"][street]["probabilidadSaltoDeCarril"] = json!(value);
                    }
                    StreetChange::LaneGeneration { lane, enabled } => {
                        self.model.street_config_mut(street).lane_generation_enabled[lane] =
                            Some(enabled);
                        self.data["calles"][street]["laneGenerationEnabled"][lane] = json!(enabled);
                    }
                }
                if let Some(curve) = curve {
                    let lanes = self.model.streets()[street].config().carriles;
                    self.reconcile_dimensions(street, lanes, curve.cell_count());
                    curve.write_json(&mut self.data["calles"][street]);
                    self.layout[street].origin = curve.start();
                    self.layout[street].curved = true;
                    self.layout[street].vertices.clear();
                    self.layout[street].bezier = Some(curve);
                }
                Ok(StreetEvent::Updated(street))
            }
        }
    }

    pub fn validate_street_edit(
        &self,
        edit: &crate::streets::StreetEdit,
    ) -> Result<(), StreetError> {
        self.prepare_street_edit(edit).map(|_| ())
    }

    fn prepare_street_edit(
        &self,
        edit: &crate::streets::StreetEdit,
    ) -> Result<Option<crate::bezier::BezierCurve>, StreetError> {
        let mut prepared_curve = None;
        if let Some(snapshot) = &self.edit_session {
            let allowed = matches!(
                edit,
                crate::streets::StreetEdit::SaveSession | crate::streets::StreetEdit::CancelSession
            ) || matches!(edit, crate::streets::StreetEdit::Update(id, StreetChange::Origin(_) | StreetChange::Angle(_))
                    if *id == snapshot.street);
            if !allowed {
                return Err(StreetError("streetInspector.errors.geometry"));
            }
        }
        match edit {
            crate::streets::StreetEdit::Create(definition) => {
                definition.validate()?;
                self.street_from_definition(definition)
                    .map_err(|_| StreetError("streetDrawing.invalid"))?;
            }
            crate::streets::StreetEdit::BeginSession(street) => {
                if *street >= self.layout.len() {
                    return Err(StreetError("streetDrawing.invalid"));
                }
            }
            crate::streets::StreetEdit::SaveSession | crate::streets::StreetEdit::CancelSession => {
                if self.edit_session.is_none() {
                    return Err(StreetError("streetInspector.errors.geometry"));
                }
            }
            crate::streets::StreetEdit::Bulk {
                streets,
                lanes,
                directions,
            } => {
                if streets.is_empty() || directions.len() != *lanes {
                    return Err(StreetError("streetInspector.errors.lanes"));
                }
                let mut unique = std::collections::BTreeSet::new();
                let mut total: usize = self.model.streets().iter().map(|s| s.cells().len()).sum();
                for &street in streets {
                    if !unique.insert(street) {
                        return Err(StreetError("streetDrawing.invalid"));
                    }
                    let old = self
                        .model
                        .streets()
                        .get(street)
                        .ok_or(StreetError("streetDrawing.invalid"))?
                        .config();
                    let change = StreetChange::Dimensions {
                        lanes: *lanes,
                        length: old.tamano,
                    };
                    change.validate(old)?;
                    if let Some(curve) = self.curve_candidate(street, &change)? {
                        curve.validate(*lanes)?;
                    }
                    total = total - old.carriles * old.tamano + lanes * old.tamano;
                }
                crate::streets::validate_cell_capacity(total, 0, 0)?;
            }
            crate::streets::StreetEdit::DrawRoundabout(draft) => {
                self.new_roundabout(*draft)?;
            }
            crate::streets::StreetEdit::Draw(draft) => {
                self.new_street(*draft)
                    .map_err(|_| StreetError("streetDrawing.invalid"))?;
            }
            crate::streets::StreetEdit::Delete(street) => {
                if *street >= self.layout.len() {
                    return Err(StreetError("streetDrawing.invalid"));
                }
            }
            crate::streets::StreetEdit::Update(street, change) => {
                let old = self
                    .model
                    .streets()
                    .get(*street)
                    .ok_or(StreetError("streetDrawing.invalid"))?
                    .config();
                change.validate(old)?;
                if matches!(change, StreetChange::StraightGeometry { .. })
                    && (self.layout[*street].curved || self.layout[*street].roundabout.is_some())
                {
                    return Err(StreetError("streetInspector.errors.geometry"));
                }
                if let Some(curve) = self.curve_candidate(*street, change)? {
                    let lanes = match change {
                        StreetChange::Dimensions { lanes, .. } => *lanes,
                        _ => old.carriles,
                    };
                    let cells = curve.validate(lanes)?;
                    let total: usize = self.model.streets().iter().map(|s| s.cells().len()).sum();
                    crate::streets::validate_cell_capacity(
                        total,
                        old.carriles * old.tamano,
                        lanes * cells,
                    )?;
                    prepared_curve = Some(curve);
                }
                let ring = self.layout[*street].roundabout;
                match change {
                    StreetChange::Radius(_) if ring.is_none() => {
                        return Err(StreetError("roundaboutDrawing.invalid"));
                    }
                    StreetChange::Dimensions { length, .. }
                        if ring.is_some() && *length != old.tamano =>
                    {
                        return Err(StreetError("roundaboutDrawing.invalid"));
                    }
                    StreetChange::Type(tipo) if ring.is_some() && *tipo != CalleType::Conexion => {
                        return Err(StreetError("roundaboutDrawing.invalid"));
                    }
                    _ => {}
                }
                let size = match change {
                    StreetChange::Radius(radius) => Some((
                        old.carriles,
                        crate::streets::RoundaboutDraft::new(
                            self.layout[*street].origin,
                            *radius,
                            0.0,
                        )?
                        .cells(),
                    )),
                    StreetChange::Dimensions { lanes, length } => Some((*lanes, *length)),
                    StreetChange::StraightGeometry { length, .. } => Some((old.carriles, *length)),
                    _ => None,
                };
                if let Some((lanes, length)) = size {
                    let total: usize = self.model.streets().iter().map(|s| s.cells().len()).sum();
                    crate::streets::validate_cell_capacity(
                        total,
                        old.carriles * old.tamano,
                        lanes * length,
                    )?;
                }
            }
        }
        Ok(prepared_curve)
    }

    fn curve_candidate(
        &self,
        street: usize,
        change: &StreetChange,
    ) -> Result<Option<crate::bezier::BezierCurve>, StreetError> {
        use crate::bezier::{BezierChange, BezierCurve, Section};
        let placement = &self.layout[street];
        let config = self.model.streets()[street].config();
        let invalid = StreetError("bezier.invalidControls");
        if let StreetChange::Bezier(BezierChange::Convert) = change {
            if placement.bezier.is_some() || placement.roundabout.is_some() || placement.curved {
                return Err(invalid);
            }
            let angle = -placement.angle_degrees.to_radians();
            let end = [
                placement.origin[0] + angle.cos() * config.tamano as f64,
                placement.origin[1] + angle.sin() * config.tamano as f64,
            ];
            return BezierCurve::new(
                placement.origin,
                vec![Section {
                    controls: vec![std::array::from_fn(|i| {
                        (placement.origin[i] + end[i]) / 2.0
                    })],
                    end,
                }],
            )
            .map(Some);
        }
        let Some(curve) = &placement.bezier else {
            return if matches!(change, StreetChange::Bezier(_)) {
                Err(invalid)
            } else {
                Ok(None)
            };
        };
        match change {
            StreetChange::Bezier(edit) => curve.changed(edit).map(Some),
            StreetChange::Origin(origin) => curve.transformed(*origin, 0.0).map(Some),
            StreetChange::Angle(angle) => curve
                .transformed(
                    placement.origin,
                    -(angle - placement.angle_degrees).to_radians(),
                )
                .map(Some),
            StreetChange::Dimensions { length, .. } => {
                if *length != config.tamano {
                    return Err(invalid);
                }
                Ok(Some(curve.clone()))
            }
            _ => Ok(None),
        }
    }

    /// Central reconciliation boundary. Later ports add parking and scenario state here.
    fn reconcile_dimensions(&mut self, street: usize, lanes: usize, length: usize) {
        let old = self.model.streets()[street].config();
        if old.periodic {
            let old_length = old.tamano;
            for link in self.data["conexiones"]
                .as_array_mut()
                .expect("validated links")
            {
                let source = link["origenIdx"].as_u64() == Some(street as u64);
                let destination = link["destinoIdx"].as_u64() == Some(street as u64);
                for row in link["detalles"].as_array_mut().expect("validated rows") {
                    for (key, applies) in [("posOrigen", source), ("posDestino", destination)] {
                        if applies && let Some(index) = row[key].as_u64() {
                            row[key] = json!(crate::streets::angular_index(
                                index as usize,
                                old_length,
                                length
                            ));
                        }
                    }
                }
            }
        }
        self.model.resize_street(street, lanes, length);
        let road = &mut self.data["calles"][street];
        road["carriles"] = json!(lanes);
        road["tamano"] = json!(length);
        let config = self.model.streets()[street].config();
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
        self.data["conexiones"]
            .as_array_mut()
            .expect("validated links")
            .retain_mut(|link| {
                let source = integer(&link["origenIdx"]).expect("validated source");
                let destination = integer(&link["destinoIdx"]).expect("validated destination");
                let weighted_split = link["weightedSplit"] == true;
                let rows = link["detalles"].as_array_mut().expect("validated rows");
                rows.retain(|r| {
                    parse_mapping(source, destination, r)
                        .expect("validated mapping")
                        .fits_resized_street(street, lanes, length)
                });
                if weighted_split && !rows.is_empty() {
                    let sum: f64 = rows
                        .iter()
                        .map(|r| r["probabilidad"].as_f64().expect("validated weight"))
                        .sum();
                    let count = rows.len() as f64;
                    for row in rows.iter_mut() {
                        let weight = row["probabilidad"].as_f64().expect("validated weight");
                        row["probabilidad"] =
                            json!(if sum > 0.0 { weight / sum } else { 1.0 / count });
                    }
                }
                !rows.is_empty()
            });
    }

    fn new_street(&self, draft: crate::streets::StreetDraft) -> Result<Self, MapError> {
        self.street_from_definition(&crate::streets::StreetDefinition {
            name: self.next_street_name(),
            draft,
            lanes: 1,
            tipo: CalleType::Conexion,
            generation: 0.0,
            lane_change: 0.02,
        })
    }

    fn street_from_definition(
        &self,
        definition: &crate::streets::StreetDefinition,
    ) -> Result<Self, MapError> {
        definition.validate().map_err(|_| MapError)?;
        let draft = definition.draft;
        let total: usize = self.model.streets().iter().map(|s| s.cells().len()).sum();
        if total.saturating_add(draft.cells * definition.lanes) > 1_000_000 {
            return Err(MapError);
        }
        // Reuse the file validator for this street only, never reparse the map.
        Self::parse(
            &json!({"calles": [{
                "nombre": definition.name.trim(), "tipo": match definition.tipo {
                    CalleType::Generador => "generador", CalleType::Conexion => "conexion", CalleType::Devorador => "devorador",
                },
                "tamano": draft.cells, "carriles": definition.lanes,
                "x": draft.origin[0] * 5.0, "y": draft.origin[1] * 5.0,
                "angulo": draft.angle_degrees, "probabilidadSaltoDeCarril": definition.lane_change,
                "probabilidadGeneracion": if definition.tipo == CalleType::Generador { definition.generation } else { 0.0 },
            }]})
            .to_string(),
        )
    }

    fn new_roundabout(&self, draft: crate::streets::RoundaboutDraft) -> Result<Self, StreetError> {
        crate::streets::RoundaboutDraft::new(draft.center, draft.inner_radius, draft.start_angle)?;
        let total: usize = self.model.streets().iter().map(|s| s.cells().len()).sum();
        if total.saturating_add(draft.cells()) > 1_000_000 {
            return Err(StreetError("streetInspector.errors.capacity"));
        }
        Self::parse(
            &json!({"calles":[{
                "nombre":self.next_street_name(), "tipo":"conexion", "geometryType":"roundabout",
                "x":draft.center[0] * 5.0, "y":draft.center[1] * 5.0,
                "innerRadius":draft.inner_radius * 5.0, "startAngle":draft.start_angle,
                "angulo":draft.start_angle, "tamano":draft.cells(), "carriles":1,
                "probabilidadSaltoDeCarril":0.02
            }]})
            .to_string(),
        )
        .map_err(|_| StreetError("roundaboutDrawing.invalid"))
    }

    pub fn draw_street(&mut self, draft: crate::streets::StreetDraft) -> Result<usize, MapError> {
        let candidate = self.new_street(draft)?;
        Ok(self.insert_street(candidate))
    }

    fn next_street_name(&self) -> String {
        let mut n = 1;
        while self.layout.iter().any(|p| p.name == format!("Street {n}")) {
            n += 1;
        }
        format!("Street {n}")
    }

    fn insert_street(&mut self, mut candidate: Self) -> usize {
        let id = self.layout.len();
        self.model.add_street(candidate.model.streets()[0].clone());
        self.layout.push(candidate.layout.remove(0));
        self.data["calles"]
            .as_array_mut()
            .expect("validated roads")
            .push(candidate.data["calles"][0].take());
        id
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
            let mut length = integer(&road["tamano"])?;
            if !(1..=10).contains(&lanes) || !(1..=2500).contains(&length) {
                return Err(MapError);
            }
            let bezier = crate::bezier::from_json(road).map_err(|_| MapError)?;
            if let Some(curve) = &bezier {
                if road["geometryType"] == "roundabout" {
                    return Err(MapError);
                }
                let cells = curve.validate(lanes).map_err(|_| MapError)?;
                // v1 reconciles old segmented files after its seam-rounding pass.
                if cells != length && !road["bezierSegments"].is_array() {
                    return Err(MapError);
                }
                length = cells;
                road["tamano"] = json!(cells);
                road["vertices"] = json!([]);
                road["esCurva"] = json!(true);
                road["bezierGeometry"] = json!(true);
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
                bezier,
                roundabout: if road["geometryType"] == "roundabout" {
                    let draft = crate::streets::RoundaboutDraft::new(
                        [number(&road["x"])? / 5.0, number(&road["y"])? / 5.0],
                        number(&road["innerRadius"])? / 5.0,
                        number(&road["startAngle"])?,
                    )
                    .map_err(|_| MapError)?;
                    if tipo != CalleType::Conexion || draft.cells() != length {
                        return Err(MapError);
                    }
                    Some(draft)
                } else {
                    None
                },
                name: road["nombre"].as_str().ok_or(MapError)?.to_owned(),
                origin: [number(&road["x"])? / 5.0, number(&road["y"])? / 5.0],
                angle_degrees: number(
                    &road[if road["geometryType"] == "roundabout" {
                        "startAngle"
                    } else {
                        "angulo"
                    }],
                )?,
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
                        && road.get("bezierSegments").is_none()
                    {
                        initialize_vertices(length)
                    } else {
                        vertices
                    }
                },
            });
            let mut config = CalleConfig::new(lanes, length, tipo);
            config.periodic = road["geometryType"] == "roundabout";
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
            let weighted_split = link
                .get("weightedSplit")
                .map(|v| v.as_bool().ok_or(MapError))
                .transpose()?
                .unwrap_or(false);
            let independent = link
                .get("independentProbabilities")
                .map(|v| v.as_bool().ok_or(MapError))
                .transpose()?
                .unwrap_or(false);
            if ((weighted_split || independent) && kind != "PROBABILISTICA")
                || (weighted_split && independent)
            {
                return Err(MapError);
            }
            let details = link["detalles"].as_array_mut().ok_or(MapError)?;
            if details.is_empty() {
                return Err(MapError);
            }
            let mut merge = Vec::new();
            let mut split = Vec::new();
            for detail in details {
                let object = detail.as_object_mut().ok_or(MapError)?;
                object.entry("posOrigen").or_insert(json!(-1));
                object.entry("posDestino").or_insert(json!(0));
                object.entry("probabilidad").or_insert(json!(1.0));
                let mapping = parse_mapping(source, destination, detail)?;
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
                        let row = WeightedRow { mapping, weight };
                        if weighted_split || independent {
                            split.push(row);
                        } else {
                            connections.push(Connection::ProbabilityTrial(row));
                        }
                    }
                    _ => return Err(MapError),
                }
            }
            if !merge.is_empty() {
                connections.push(Connection::Incorporacion(merge));
            }
            if weighted_split {
                connections.push(Connection::Probabilistica(split));
            } else if independent {
                connections.push(Connection::ProbabilityTrials(split));
            }
        }
        for connection in connections {
            model
                .add_saved_connection(connection)
                .map_err(|_| MapError)?;
        }
        let zones = parse_zones(root.get("backgroundAreas"))?;
        let buildings = match root.get("edificios") {
            Some(Value::Array(values)) => values
                .iter()
                .map(crate::buildings::Building::from_json)
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| MapError)?,
            None => Vec::new(),
            _ => return Err(MapError),
        };
        let time = crate::virtual_time::VirtualTime::from_json(&data["configuracionTiempo"])
            .ok_or(MapError)?;
        Ok(Self {
            buildings,
            time: Box::new(time),
            edit_session: None,
            data,
            model,
            layout,
            zones,
        })
    }

    pub fn model(&self) -> &TrafficModel {
        &self.model
    }

    pub fn time(&self) -> &crate::virtual_time::VirtualTime {
        &self.time
    }

    /// Profile is sampled before generation; the clock advances after traffic.
    pub fn tick(&mut self) {
        self.model
            .set_hourly_multiplier(self.time.multiplier())
            .expect("validated profiles");
        self.model.tick();
        self.time.advance();
    }

    pub fn set_time(&mut self, time: crate::virtual_time::VirtualTime) {
        *self.time = time;
    }

    /// Scenario reset is not map replacement and does not execute a traffic tick.
    pub fn reset_scenario_time(&mut self, clock: crate::virtual_time::Clock) {
        self.model.clear_vehicles();
        self.time.clock = clock;
    }

    /// Older maps omit the switch. Resolve it before replacing the live session.
    pub fn inherit_profile_switch(&mut self, current: bool) {
        if self.data["configuracionTiempo"]
            .get("usarPerfiles")
            .is_none()
        {
            self.time.enabled = current;
        }
    }

    /// Register one street-pair link atomically in both traffic and map data.
    pub fn add_connection(
        &mut self,
        connection: Connection,
    ) -> Result<(), crate::connections::ConnectionError> {
        self.model.validate_connection(&connection)?;
        let link = Self::connection_data(&connection)?;
        self.model.add_connection(connection)?;
        self.data["conexiones"]
            .as_array_mut()
            .expect("validated links")
            .push(link);
        Ok(())
    }

    fn connection_data(
        connection: &Connection,
    ) -> Result<Value, crate::connections::ConnectionError> {
        use crate::connections::ConnectionError;
        let first = *connection
            .mappings()
            .next()
            .ok_or(ConnectionError::InvalidMapping)?;
        if connection.mappings().any(|m| {
            m.source_street != first.source_street
                || m.destination_street != first.destination_street
        }) {
            return Err(ConnectionError::InvalidMapping);
        }
        let kind = match connection {
            Connection::Lineal(_) => "LINEAL",
            Connection::Incorporacion(_) => "INCORPORACION",
            Connection::ProbabilityTrial(_)
            | Connection::ProbabilityTrials(_)
            | Connection::Probabilistica(_) => "PROBABILISTICA",
        };
        let details: Vec<_> = connection.mappings().enumerate().map(|(index, mapping)| {
            let weight = match connection {
                Connection::ProbabilityTrial(row) => row.weight,
                Connection::ProbabilityTrials(rows) | Connection::Probabilistica(rows) => rows[index].weight,
                _ => 1.0,
            };
            let enabled = match connection {
                Connection::Incorporacion(rows) => rows[index].enabled,
                _ => true,
            };
            json!({
                "carrilOrigen": mapping.source_lane, "posOrigen": mapping.source_cell,
                "carrilDestino": mapping.destination_lane, "posDestino": mapping.destination_cell,
                "probabilidad": weight, "enabled": enabled
            })
        }).collect();
        let mut link = json!({
            "origenIdx": first.source_street, "destinoIdx": first.destination_street,
            "tipo": kind, "detalles": details
        });
        // Optional v2 grouping marker. Unmarked v1 links remain independent trials.
        if matches!(connection, Connection::Probabilistica(_)) {
            link["weightedSplit"] = json!(true);
        } else if matches!(connection, Connection::ProbabilityTrials(_)) {
            link["independentProbabilities"] = json!(true);
        }
        Ok(link)
    }

    pub fn replace_connection(
        &mut self,
        index: usize,
        connection: Connection,
    ) -> Result<(), crate::connections::ConnectionError> {
        self.model
            .validate_connection_replacement(index, &connection)?;
        let link = Self::connection_data(&connection)?;
        let slot = self.connection_slot(index);
        let mut saved = self.data["conexiones"][slot].clone();
        let old_details = saved["detalles"].as_array().expect("validated details");
        let mut details = link["detalles"]
            .as_array()
            .expect("encoded details")
            .clone();
        for (row_index, detail) in details.iter_mut().enumerate() {
            let previous = old_details
                .iter()
                .find(|old| {
                    ["carrilOrigen", "posOrigen", "carrilDestino", "posDestino"]
                        .iter()
                        .all(|key| old[*key] == detail[*key])
                })
                .or_else(|| old_details.get(row_index));
            if let Some(previous) = previous {
                let mut fields = previous.as_object().expect("validated detail").clone();
                fields.extend(detail.as_object().expect("encoded detail").clone());
                *detail = Value::Object(fields);
            }
        }
        let fields = saved.as_object_mut().expect("validated link");
        fields.remove("weightedSplit");
        fields.remove("independentProbabilities");
        fields.extend(link.as_object().expect("encoded link").clone());
        saved["detalles"] = Value::Array(details);
        self.model.replace_connection(index, connection)?;
        self.data["conexiones"][slot] = saved;
        Ok(())
    }

    pub fn delete_connection(&mut self, index: usize) -> bool {
        if index >= self.model.connections().len() {
            return false;
        }
        let slot = self.connection_slot(index);
        self.model.delete_connection(index);
        self.data["conexiones"]
            .as_array_mut()
            .expect("validated links")
            .remove(slot);
        true
    }

    /// Only split the selected legacy JSON entry. Other metadata stays intact.
    fn connection_slot(&mut self, index: usize) -> usize {
        let links = self.data["conexiones"]
            .as_array_mut()
            .expect("validated links");
        let mut start = 0;
        for slot in 0..links.len() {
            let link = &links[slot];
            let separate = link["tipo"] == "LINEAL"
                || (link["tipo"] == "PROBABILISTICA"
                    && link["weightedSplit"] != true
                    && link["independentProbabilities"] != true);
            let count = if separate {
                link["detalles"]
                    .as_array()
                    .expect("validated details")
                    .len()
            } else {
                1
            };
            if index < start + count {
                if count == 1 {
                    return slot;
                }
                let parts: Vec<_> = link["detalles"]
                    .as_array()
                    .expect("validated details")
                    .iter()
                    .map(|detail| {
                        let mut part = link.clone();
                        part["detalles"] = json!([detail]);
                        part
                    })
                    .collect();
                links.splice(slot..=slot, parts);
                return slot + index - start;
            }
            start += count;
        }
        unreachable!("validated connection index")
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
        let mut data = self.data.clone();
        if !data["configuracionTiempo"].is_object() {
            data["configuracionTiempo"] = serde_json::json!({});
        }
        data["configuracionTiempo"]
            .as_object_mut()
            .expect("time object")
            .extend(
                self.time
                    .to_json()
                    .as_object()
                    .expect("time object")
                    .clone(),
            );
        serde_json::to_string_pretty(&data).expect("validated map")
    }
}

fn integer(value: &Value) -> Result<usize, MapError> {
    value
        .as_u64()
        .and_then(|n| usize::try_from(n).ok())
        .ok_or(MapError)
}

fn parse_mapping(source: usize, destination: usize, detail: &Value) -> Result<Mapping, MapError> {
    Ok(Mapping {
        source_street: source,
        destination_street: destination,
        source_lane: integer(&detail["carrilOrigen"])?,
        destination_lane: integer(&detail["carrilDestino"])?,
        source_cell: detail["posOrigen"]
            .as_i64()
            .and_then(|v| isize::try_from(v).ok())
            .ok_or(MapError)?,
        destination_cell: integer(&detail["posDestino"])?,
    })
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
