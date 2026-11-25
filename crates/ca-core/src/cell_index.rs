//! Spatial cell centers, independent of traffic values and lane directions.
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, PartialEq)]
pub struct StreetGeometry {
    pub id: usize,
    /// Lane-major centers, in zero-based physical cell order.
    pub centers: Vec<Vec<[f32; 2]>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellRef {
    pub street: usize,
    pub lane: usize,
    pub index: usize,
}

#[derive(Clone, Copy)]
struct Entry {
    cell: CellRef,
    center: [f32; 2],
}

type Bucket = (i32, i32);

struct StreetRecord {
    // The full coordinate signature avoids hash collisions and catches in-place edits.
    geometry: StreetGeometry,
    keys: HashSet<Bucket>,
}

pub struct CellIndex {
    size: f32,
    streets: HashMap<usize, StreetRecord>,
    order: HashMap<usize, usize>,
    buckets: HashMap<Bucket, Vec<Entry>>,
}

impl CellIndex {
    pub fn new(cell_size: f32) -> Self {
        assert!(cell_size.is_finite() && cell_size > 0.0);
        Self {
            size: cell_size,
            streets: HashMap::new(),
            order: HashMap::new(),
            buckets: HashMap::new(),
        }
    }

    /// Geometry owners call this after edits/replacement. Returns rebuilt street count.
    /// Unchanged signatures retain their entries. Traffic changes need no sync.
    pub fn sync(&mut self, streets: &[StreetGeometry]) -> usize {
        self.order = streets.iter().enumerate().map(|(i, s)| (s.id, i)).collect();
        let removed: Vec<_> = self
            .streets
            .keys()
            .copied()
            .filter(|id| !self.order.contains_key(id))
            .collect();
        for id in removed {
            self.invalidate(id);
        }
        let mut rebuilt = 0;
        for geometry in streets {
            if self
                .streets
                .get(&geometry.id)
                .is_some_and(|old| old.geometry == *geometry)
            {
                continue;
            }
            self.invalidate(geometry.id);
            let mut keys = HashSet::new();
            for (lane, centers) in geometry.centers.iter().enumerate() {
                for (index, &center) in centers.iter().enumerate() {
                    if !center.into_iter().all(f32::is_finite) {
                        continue;
                    }
                    let key = self.key(center);
                    keys.insert(key);
                    self.buckets.entry(key).or_default().push(Entry {
                        cell: CellRef {
                            street: geometry.id,
                            lane,
                            index,
                        },
                        center,
                    });
                }
            }
            self.streets.insert(
                geometry.id,
                StreetRecord {
                    geometry: geometry.clone(),
                    keys,
                },
            );
            rebuilt += 1;
        }
        rebuilt
    }

    pub fn invalidate(&mut self, street: usize) {
        if let Some(record) = self.streets.remove(&street) {
            for key in record.keys {
                if let Some(entries) = self.buckets.get_mut(&key) {
                    entries.retain(|entry| entry.cell.street != street);
                    if entries.is_empty() {
                        self.buckets.remove(&key);
                    }
                }
            }
        }
    }

    pub fn clear(&mut self) {
        self.streets.clear();
        self.buckets.clear();
        self.order.clear();
    }

    pub fn find_nearest(&self, point: [f32; 2]) -> Option<CellRef> {
        let mut best = None;
        let mut distance = self.size * self.size;
        self.visit(point, |entry, d| {
            let rank = (
                self.order[&entry.cell.street],
                entry.cell.lane,
                entry.cell.index,
            );
            if d < distance || (d == distance && best.is_some_and(|(_, old_rank)| rank < old_rank))
            {
                best = Some((entry.cell, rank));
                distance = d;
            }
        });
        best.map(|(cell, _)| cell)
    }

    /// Candidates in topmost-first drawing order, within the strict v1 radius.
    pub fn nearby_streets(&self, point: [f32; 2]) -> Vec<usize> {
        let mut found = Vec::new();
        self.visit(point, |entry, distance| {
            if distance < self.size * self.size && !found.contains(&entry.cell.street) {
                found.push(entry.cell.street);
            }
        });
        found.sort_unstable_by_key(|id| std::cmp::Reverse(self.order[id]));
        found
    }

    /// Axis-aligned cell footprints used by the current straight-street renderer.
    /// Topmost street wins; physical lane/index order breaks same-street ties.
    pub fn hit_test(&self, point: [f32; 2]) -> Option<CellRef> {
        let mut best = None;
        self.visit(point, |entry, _| {
            if (0..2).all(|i| {
                let local = point[i] - entry.center[i];
                local >= -self.size * 0.5 && local < self.size * 0.5
            }) {
                let rank = (
                    std::cmp::Reverse(self.order[&entry.cell.street]),
                    entry.cell.lane,
                    entry.cell.index,
                );
                if best.is_none_or(|(_, old_rank)| rank < old_rank) {
                    best = Some((entry.cell, rank));
                }
            }
        });
        best.map(|(cell, _)| cell)
    }

    fn key(&self, point: [f32; 2]) -> Bucket {
        (
            (point[0] / self.size).floor() as i32,
            (point[1] / self.size).floor() as i32,
        )
    }

    fn visit(&self, point: [f32; 2], mut visit: impl FnMut(Entry, f32)) {
        if !point.into_iter().all(f32::is_finite) {
            return;
        }
        let (x, y) = self.key(point);
        for dx in -1..=1 {
            for dy in -1..=1 {
                let (Some(x), Some(y)) = (x.checked_add(dx), y.checked_add(dy)) else {
                    continue;
                };
                if let Some(entries) = self.buckets.get(&(x, y)) {
                    for &entry in entries {
                        let d = (point[0] - entry.center[0]).powi(2)
                            + (point[1] - entry.center[1]).powi(2);
                        visit(entry, d);
                    }
                }
            }
        }
    }
}
