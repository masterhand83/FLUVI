//! Headless CPU traffic model and rules.

pub mod bezier;
pub mod buildings;
pub mod camera;
pub mod cell_index;
pub mod geometry;
pub mod map_json;
mod random;
pub mod streets;
pub mod traffic;
pub mod virtual_time;
pub use traffic::connections;
pub use traffic::parking;
mod traffic_rules;
