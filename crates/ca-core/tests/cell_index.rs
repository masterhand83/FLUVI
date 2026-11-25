use ca_core::cell_index::{CellIndex, CellRef, StreetGeometry};

fn roads() -> Vec<StreetGeometry> {
    vec![
        StreetGeometry {
            id: 10,
            centers: vec![vec![[0.5, 0.5], [1.5, 0.5]], vec![[0.5, 1.5], [1.5, 1.5]]],
        },
        StreetGeometry {
            id: 20,
            centers: vec![vec![[0.5, 0.5], [1.5, 0.5]]],
        },
    ]
}

#[test]
fn nearest_retains_v1_street_lane_and_physical_index_tie_order() {
    let mut index = CellIndex::new(1.0);
    index.sync(&roads());
    assert_eq!(
        index.find_nearest([1.0, 1.0]),
        Some(CellRef {
            street: 10,
            lane: 0,
            index: 0
        })
    );
    assert_eq!(
        index.find_nearest([1.5, 0.5]),
        Some(CellRef {
            street: 10,
            lane: 0,
            index: 1
        })
    );
    assert_eq!(
        index.find_nearest([2.5, 0.5]),
        None,
        "distance limit is strict"
    );
    assert_eq!(index.find_nearest([f32::NAN, 0.0]), None);
}

#[test]
fn random_queries_match_independent_brute_force_scan() {
    let mut streets = roads();
    streets.push(StreetGeometry {
        id: 30,
        centers: vec![
            (0..80)
                .map(|i| {
                    let angle = i as f32 * 0.17;
                    [angle.cos() * 8.0 - 2.0, angle.sin() * 8.0 + 3.0]
                })
                .collect(),
        ],
    });
    let mut index = CellIndex::new(1.0);
    index.sync(&streets);
    let mut seed = 47_u64;
    for _ in 0..5000 {
        let point = std::array::from_fn(|_| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            ((seed >> 32) as u32 as f32 / u32::MAX as f32) * 30.0 - 15.0
        });
        let mut best = None;
        let mut distance = 1.0;
        for street in &streets {
            for (lane, centers) in street.centers.iter().enumerate() {
                for (physical, center) in centers.iter().enumerate() {
                    let dx = center[0] - point[0];
                    let dy = center[1] - point[1];
                    let d = dx * dx + dy * dy;
                    if d < distance {
                        distance = d;
                        best = Some(CellRef {
                            street: street.id,
                            lane,
                            index: physical,
                        });
                    }
                }
            }
        }
        assert_eq!(index.find_nearest(point), best, "{point:?}");
    }
}

#[test]
fn geometry_changes_rebuild_only_the_edited_street_and_remove_old_entries() {
    let mut streets = roads();
    let mut index = CellIndex::new(1.0);
    assert_eq!(index.sync(&streets), 2);
    assert_eq!(index.sync(&streets), 0);
    assert_eq!(index.nearby_streets([0.5, 0.5]), [20, 10]);
    assert_eq!(index.hit_test([0.5, 0.5]).unwrap().street, 20);
    streets[1].centers[0][0] = [100.5, 100.5];
    assert_eq!(index.sync(&streets), 1);
    assert_eq!(index.hit_test([0.5, 0.5]).unwrap().street, 10);
    assert_eq!(index.find_nearest([100.5, 100.5]).unwrap().street, 20);
    index.invalidate(10);
    assert_eq!(index.sync(&streets), 1);
    streets.reverse();
    assert_eq!(index.sync(&streets), 0);
    assert_eq!(index.find_nearest([1.5, 0.5]).unwrap().street, 20);
    streets.remove(0);
    assert_eq!(index.sync(&streets), 0);
    assert_eq!(index.find_nearest([100.5, 100.5]), None);
    index.clear();
    assert_eq!(index.find_nearest([1.5, 0.5]), None);
}
