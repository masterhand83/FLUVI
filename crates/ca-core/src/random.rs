// SplitMix64: fixed algorithm, independent of external RNG versions.
pub(crate) fn next_u64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e3779b97f4a7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
    z ^ (z >> 31)
}

pub(crate) fn unit(state: &mut u64) -> f64 {
    // Use the high 53 bits for a value in [0, 1).
    (next_u64(state) >> 11) as f64 / (1_u64 << 53) as f64
}
