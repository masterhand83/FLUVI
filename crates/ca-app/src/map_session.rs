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
    document: MapDocument,
    resets: Vec<ResetStep<S>>,
    street_listeners: Vec<StreetListener>,
}

impl<S> MapSession<S> {
    pub fn new(document: MapDocument) -> Self {
        Self {
            document,
            resets: Vec::new(),
            street_listeners: Vec::new(),
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

    pub fn on_street_event(&mut self, listener: StreetListener) {
        self.street_listeners.push(listener);
    }

    pub fn edit_streets(
        &mut self,
        edit: ca_core::streets::StreetEdit,
    ) -> Result<crate::streets::StreetEvent, ca_core::streets::StreetError> {
        let event = self.document.edit_streets(edit)?;
        for listener in &self.street_listeners {
            listener(event, &self.document);
        }
        Ok(event)
    }

    pub fn set_vertex_offset(&mut self, street: usize, vertex: usize, offset: f64) -> bool {
        self.document.set_vertex_offset(street, vertex, offset)
    }

    pub fn replace(&mut self, accepted: bool, candidate: MapDocument, state: &mut S) -> bool {
        if !accepted {
            return false;
        }
        for (_, reset) in &self.resets {
            reset(state);
        }
        self.document = candidate;
        true
    }

    pub fn load(&mut self, text: &str, state: &mut S) -> Result<(), MapError> {
        let candidate = MapDocument::parse(text)?;
        self.replace(true, candidate, state);
        Ok(())
    }
}
