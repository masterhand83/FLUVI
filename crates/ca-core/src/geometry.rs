//! Legacy vertex integration. f64 preserves v1's cumulative coordinate order.
use crate::map_json::StreetPlacement;

#[derive(Clone, Debug)]
pub struct Vertex {
    pub index: usize,
    pub offset: f64,
}

pub struct CellGeometry {
    pub centers: Vec<Vec<[f32; 2]>>,
    pub axes: Vec<Vec<[f32; 2]>>,
}

pub fn initialize_vertices(length: usize) -> Vec<Vertex> {
    let mut indices: Vec<_> = (0..=length / 10)
        .map(|i| (i * 10).min(length - 1))
        .collect();
    if indices.last() != Some(&(length - 1)) {
        indices.push(length - 1);
    }
    indices
        .into_iter()
        .map(|index| Vertex { index, offset: 0.0 })
        .collect()
}

impl StreetPlacement {
    pub fn set_vertex_offset(&mut self, vertex: usize, offset: f64) -> bool {
        if self.roundabout.is_some() || !offset.is_finite() || vertex >= self.vertices.len() {
            return false;
        }
        let mut offset = offset.clamp(-90.0, 90.0);
        for neighbor in [vertex.checked_sub(1), vertex.checked_add(1)] {
            if let Some(v) = neighbor.and_then(|i| self.vertices.get(i)) {
                offset = offset.clamp(v.offset - 90.0, v.offset + 90.0);
            }
        }
        self.vertices[vertex].offset = offset;
        self.curved = true;
        true
    }

    pub fn angle_at(&self, index: usize) -> f64 {
        let base = self.angle_degrees;
        if self.curved {
            for pair in self.vertices.windows(2) {
                if index >= pair[0].index && index <= pair[1].index {
                    let span = pair[1].index - pair[0].index;
                    let t = if span == 0 {
                        0.0
                    } else {
                        (index - pair[0].index) as f64 / span as f64
                    };
                    return base + pair[0].offset + t * (pair[1].offset - pair[0].offset);
                }
            }
        }
        base
    }

    /// Lane-major centers and tangent axes in cell-sized world units.
    pub fn cells(&self, lanes: usize, length: usize) -> CellGeometry {
        let mut geometry = CellGeometry {
            centers: vec![vec![[0.0; 2]; length]; lanes],
            axes: vec![vec![[0.0; 2]; length]; lanes],
        };
        self.write_cells(&mut geometry.centers, &mut geometry.axes);
        geometry
    }

    /// Update fixed-size street storage without allocating during a drag.
    pub fn write_cells(&self, centers: &mut [Vec<[f32; 2]>], axes: &mut [Vec<[f32; 2]>]) {
        let lanes = centers.len();
        let length = centers[0].len();
        if let Some(ring) = self.roundabout {
            for lane in 0..lanes {
                let radius = ring.inner_radius + lane as f64 + 0.5;
                for index in 0..length {
                    let angle = ring.start_angle.to_radians()
                        + std::f64::consts::TAU * (index as f64 + 0.5) / length as f64;
                    centers[lane][index] = [
                        (ring.center[0] + radius * angle.cos()) as f32,
                        (ring.center[1] + radius * angle.sin()) as f32,
                    ];
                    axes[lane][index] = [-angle.sin() as f32, angle.cos() as f32];
                }
            }
            return;
        }
        let mut prefix = self.origin;
        for index in 0..length {
            let rad = -self.angle_at(index).to_radians();
            let axis = [rad.cos(), rad.sin()];
            let normal = [-axis[1], axis[0]];
            if self.curved && self.vertices.len() >= 2 && index > 0 {
                for i in 0..2 {
                    prefix[i] += axis[i];
                }
            }
            for lane in 0..lanes {
                let lateral = if self.curved && self.vertices.len() >= 2 {
                    lane as f64 - (lanes - 1) as f64 / 2.0
                } else {
                    lane as f64 + 0.5
                };
                let forward = if self.curved && self.vertices.len() >= 2 {
                    0.5
                } else {
                    index as f64 + 0.5
                };
                centers[lane][index] = std::array::from_fn(|i| {
                    (prefix[i] + axis[i] * forward + normal[i] * lateral) as f32
                });
                axes[lane][index] = axis.map(|v| v as f32);
            }
        }
    }
}
