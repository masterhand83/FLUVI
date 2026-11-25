//! Headless CPU reference models. Conway coordinates increase right and down.

pub mod traffic;
mod traffic_rules;

#[derive(Debug, thiserror::Error)]
pub enum GridError {
    #[error("grid dimensions must be nonzero and fit in u32")]
    Dimensions,
    #[error("cell data must contain width * height values, all zero or one")]
    Cells,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Grid {
    pub width: u32,
    pub height: u32,
    cells: Vec<u32>,
}

#[derive(Clone, Copy, Debug)]
pub enum Rule {
    Conway,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PopulationSample {
    /// Distinguishes reset histories and late readbacks.
    pub epoch: u64,
    pub generation: u64,
    pub population: u32,
}

impl Grid {
    pub fn new(width: u32, height: u32, cells: Vec<u32>) -> Result<Self, GridError> {
        let size = width.checked_mul(height).ok_or(GridError::Dimensions)?;
        if size == 0 {
            return Err(GridError::Dimensions);
        }
        if cells.len() != size as usize || cells.iter().any(|&c| c > 1) {
            return Err(GridError::Cells);
        }
        Ok(Self {
            width,
            height,
            cells,
        })
    }

    pub fn seeded(width: u32, height: u32, seed: u64) -> Result<Self, GridError> {
        let size = width.checked_mul(height).ok_or(GridError::Dimensions)?;
        if size == 0 {
            return Err(GridError::Dimensions);
        }
        // SplitMix64: fixed algorithm, independent of external RNG versions.
        let mut state = seed;
        let cells = (0..size)
            .map(|_| {
                state = state.wrapping_add(0x9e3779b97f4a7c15);
                let mut z = state;
                z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
                z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
                u32::from(((z ^ (z >> 31)) & 3) == 0)
            })
            .collect();
        Self::new(width, height, cells)
    }

    pub fn cells(&self) -> &[u32] {
        &self.cells
    }
    pub fn population(&self) -> u32 {
        self.cells.iter().sum()
    }

    pub fn step_into(&self, rule: Rule, output: &mut Self) -> Result<(), GridError> {
        if (self.width, self.height) != (output.width, output.height) {
            return Err(GridError::Dimensions);
        }
        match rule {
            Rule::Conway => {
                for y in 0..self.height {
                    for x in 0..self.width {
                        let mut neighbors = 0;
                        for dy in -1..=1 {
                            for dx in -1..=1 {
                                if dx == 0 && dy == 0 {
                                    continue;
                                }
                                let nx =
                                    (i64::from(x) + dx).rem_euclid(i64::from(self.width)) as u32;
                                let ny =
                                    (i64::from(y) + dy).rem_euclid(i64::from(self.height)) as u32;
                                neighbors += self.cells[(ny * self.width + nx) as usize];
                            }
                        }
                        let i = (y * self.width + x) as usize;
                        output.cells[i] =
                            u32::from(neighbors == 3 || (neighbors == 2 && self.cells[i] == 1));
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pattern(w: u32, h: u32, points: &[(u32, u32)]) -> Grid {
        let mut cells = vec![0; (w * h) as usize];
        for &(x, y) in points {
            cells[(y * w + x) as usize] = 1;
        }
        Grid::new(w, h, cells).unwrap()
    }
    fn advance(mut grid: Grid, steps: usize) -> Grid {
        let mut out = grid.clone();
        for _ in 0..steps {
            grid.step_into(Rule::Conway, &mut out).unwrap();
            std::mem::swap(&mut grid, &mut out);
        }
        grid
    }
    #[test]
    fn blinker() {
        let start = pattern(8, 8, &[(3, 2), (3, 3), (3, 4)]);
        assert_eq!(
            advance(start.clone(), 1),
            pattern(8, 8, &[(2, 3), (3, 3), (4, 3)])
        );
        assert_eq!(advance(start.clone(), 2), start);
    }
    #[test]
    fn block() {
        let start = pattern(8, 8, &[(2, 2), (3, 2), (2, 3), (3, 3)]);
        assert_eq!(advance(start.clone(), 10), start);
    }
    #[test]
    fn glider() {
        let start = pattern(8, 8, &[(2, 1), (3, 2), (1, 3), (2, 3), (3, 3)]);
        assert_eq!(
            advance(start, 4),
            pattern(8, 8, &[(3, 2), (4, 3), (2, 4), (3, 4), (4, 4)])
        );
    }
    #[test]
    fn glider_wraps_both_edges() {
        let start = pattern(8, 8, &[(7, 6), (0, 7), (6, 0), (7, 0), (0, 0)]);
        assert_eq!(
            advance(start, 4),
            pattern(8, 8, &[(0, 7), (1, 0), (7, 1), (0, 1), (1, 1)])
        );
    }
    #[test]
    fn seeded_random_is_deterministic() {
        let a = Grid::seeded(128, 128, 42).unwrap();
        assert_eq!(a, Grid::seeded(128, 128, 42).unwrap());
        assert_ne!(a, Grid::seeded(128, 128, 43).unwrap());
        assert!((3500..4700).contains(&a.population()));
    }
}
