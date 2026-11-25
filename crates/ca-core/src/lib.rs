//! Headless CPU traffic model and rules.

pub mod camera;
pub mod cell_index;
pub mod map_json;
mod random;
pub mod traffic;
pub use traffic::connections;
mod traffic_rules;
