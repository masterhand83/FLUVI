//! Local vehicle density in physical, same-lane five-cell windows.
use crate::traffic::Calle;
use crate::{cell_index::StreetGeometry, map_json::MapDocument};

#[derive(Clone, Copy, Default)]
pub struct Tile {
    pub center: [f32; 2],
    pub axis: [f32; 2],
    pub density: Option<f64>,
    pub obstacle: bool,
}

#[derive(Default)]
pub struct Snapshot {
    pub tiles: Vec<Tile>,
    streets: usize,
}

impl Snapshot {
    pub fn from_document(document: &MapDocument) -> Self {
        let geometry = document.geometry_snapshot();
        Self::from_geometry(
            document.model().streets(),
            &geometry.streets,
            &geometry.axes,
        )
    }

    /// Capture all streets; metric selection is deliberately not an input.
    pub fn from_geometry(
        streets: &[Calle],
        geometry: &[StreetGeometry],
        axes: &[Vec<Vec<[f32; 2]>>],
    ) -> Self {
        let mut snapshot = Self {
            tiles: vec![Tile::default(); streets.iter().map(|s| s.cells().len()).sum()],
            streets: streets.len(),
        };
        snapshot.refresh(streets, geometry, axes);
        snapshot
    }

    /// Update storage allocated for this topology. Callers must supply matching
    /// lane-major centers and axes from the same geometry revision.
    pub fn refresh(
        &mut self,
        streets: &[Calle],
        geometry: &[StreetGeometry],
        axes: &[Vec<Vec<[f32; 2]>>],
    ) {
        assert_eq!(self.streets, streets.len());
        assert_eq!(geometry.len(), streets.len());
        assert_eq!(axes.len(), streets.len());
        let mut tiles = self.tiles.iter_mut();
        for (id, street) in streets.iter().enumerate() {
            for (lane, centers) in geometry[id].centers.iter().enumerate() {
                for (index, &center) in centers.iter().enumerate() {
                    *tiles.next().expect("snapshot topology matches geometry") = Tile {
                        center,
                        axis: axes[id][lane][index],
                        density: local_density(street, lane, index),
                        obstacle: street.cells()[lane * street.config().tamano + index] == 7,
                    };
                }
            }
        }
        assert!(tiles.next().is_none(), "snapshot topology matches geometry");
    }

    pub fn street_count(&self) -> usize {
        self.streets
    }
}

/// Empty cells and obstructions have no heat value. Both remain in the denominator.
pub fn local_density(street: &Calle, lane: usize, index: usize) -> Option<f64> {
    let length = street.config().tamano;
    if lane >= street.config().carriles || index >= length {
        return None;
    }
    let cells = &street.cells()[lane * length..(lane + 1) * length];
    if !(1..=6).contains(&cells[index]) {
        return None;
    }
    if street.config().periodic {
        let count = length.min(5);
        let start = (index + length - 2 % length) % length;
        let vehicles = (0..count)
            .filter(|offset| (1..=6).contains(&cells[(start + offset) % length]))
            .count();
        return Some(vehicles as f64 / count as f64);
    }
    let start = index.saturating_sub(2);
    let end = index.saturating_add(3).min(length);
    let vehicles = cells[start..end]
        .iter()
        .filter(|&&value| (1..=6).contains(&value))
        .count();
    Some(vehicles as f64 / (end - start) as f64)
}
