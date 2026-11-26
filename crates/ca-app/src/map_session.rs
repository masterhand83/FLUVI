//! One replacement boundary for New and Open. Parse before resetting live state.
use ca_core::map_json::{MapDocument, MapError};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ResetPhase {
    Pause,
    Tools,
    Features,
}

type ResetStep<S> = (ResetPhase, fn(&mut S));
type StreetListener = fn(crate::streets::StreetEvent, &MapDocument);

pub struct MapSession<S> {
    revision: u64,
    document: MapDocument,
    resets: Vec<ResetStep<S>>,
    street_listeners: Vec<StreetListener>,
    scenario_resets: Vec<fn(&mut S)>,
}

impl<S> MapSession<S> {
    pub fn edit_buildings(
        &mut self,
        edit: ca_core::buildings::BuildingEdit,
    ) -> Result<Option<usize>, ca_core::buildings::BuildingError> {
        let result = self.document.edit_buildings(edit)?;
        self.revision = self.revision.wrapping_add(1);
        Ok(result)
    }
    pub fn new(document: MapDocument) -> Self {
        Self {
            revision: 0,
            document,
            resets: Vec::new(),
            street_listeners: Vec::new(),
            scenario_resets: Vec::new(),
        }
    }

    /// Steps in the same phase run in registration order.
    pub fn register_reset(&mut self, phase: ResetPhase, reset: fn(&mut S)) {
        self.resets.push((phase, reset));
        self.resets.sort_by_key(|(phase, _)| *phase);
    }

    pub fn document(&self) -> &MapDocument {
        &self.document
    }

    /// Geometry/configuration revision for retained feature overlays.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn set_time(&mut self, time: ca_core::virtual_time::VirtualTime) {
        self.document.set_time(time);
    }

    /// Feature owners register metrics and parking resets here, not map resets.
    pub fn register_scenario_reset(&mut self, reset: fn(&mut S)) {
        self.scenario_resets.push(reset);
    }

    pub fn reset_scenario_time(&mut self, clock: ca_core::virtual_time::Clock, state: &mut S) {
        for reset in &self.scenario_resets {
            reset(state);
        }
        self.document.reset_scenario_time(clock);
    }

    pub fn add_connection(
        &mut self,
        connection: ca_core::connections::Connection,
    ) -> Result<(), ca_core::connections::ConnectionError> {
        self.document.add_connection(connection)
    }

    pub fn on_street_event(&mut self, listener: StreetListener) {
        self.street_listeners.push(listener);
    }

    pub fn replace_connection(
        &mut self,
        index: usize,
        connection: ca_core::connections::Connection,
    ) -> Result<(), ca_core::connections::ConnectionError> {
        self.document.replace_connection(index, connection)
    }

    pub fn delete_connection(&mut self, index: usize) -> bool {
        self.document.delete_connection(index)
    }

    pub fn edit_streets(
        &mut self,
        edit: ca_core::streets::StreetEdit,
    ) -> Result<crate::streets::StreetEvent, ca_core::streets::StreetError> {
        let event = self.document.edit_streets(edit)?;
        self.revision = self.revision.wrapping_add(1);
        for listener in &self.street_listeners {
            listener(event, &self.document);
        }
        Ok(event)
    }

    pub fn set_vertex_offset(&mut self, street: usize, vertex: usize, offset: f64) -> bool {
        let changed = self.document.set_vertex_offset(street, vertex, offset);
        if changed {
            self.revision = self.revision.wrapping_add(1);
        }
        changed
    }

    pub fn replace(&mut self, accepted: bool, candidate: MapDocument, state: &mut S) -> bool {
        if !accepted {
            return false;
        }
        for (_, reset) in &self.resets {
            reset(state);
        }
        self.document = candidate;
        self.revision = self.revision.wrapping_add(1);
        true
    }

    pub fn load(&mut self, text: &str, state: &mut S) -> Result<(), MapError> {
        let candidate = MapDocument::parse(text)?;
        self.replace(true, candidate, state);
        Ok(())
    }
}
