//! Direct GPU display of CPU traffic state.
use bytemuck::{Pod, Zeroable};

mod background;
mod buildings;
pub use background::triangulate as triangulate_polygon;
pub use buildings::building_zone;
mod traffic;
pub use traffic::{TrafficDisplay, TrafficLane, TrafficScene, VehicleStyle};

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ViewUniform {
    origin: [f32; 2],
    span: [f32; 2],
}
const _: () = assert!(size_of::<ViewUniform>() == 16);

fn entry(
    binding: u32,
    visibility: wgpu::ShaderStages,
    ty: wgpu::BufferBindingType,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Buffer {
            ty,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

#[cfg(test)]
mod layout_tests {
    use super::*;
    use std::mem::offset_of;

    #[test]
    fn shader_facing_layouts_match_wgsl() {
        assert_eq!(size_of::<ViewUniform>(), 16);
        assert_eq!(offset_of!(ViewUniform, origin), 0);
        assert_eq!(offset_of!(ViewUniform, span), 8);
        assert_eq!(size_of::<TrafficLane>(), 32);
        assert_eq!(offset_of!(TrafficLane, origin), 0);
        assert_eq!(offset_of!(TrafficLane, offset), 8);
        assert_eq!(offset_of!(TrafficLane, length), 12);
        assert_eq!(offset_of!(TrafficLane, direction), 16);
        assert_eq!(offset_of!(TrafficLane, street_type), 20);
        assert_eq!(offset_of!(TrafficLane, axis), 24);
        // WGSL array<u32> cell storage.
        assert_eq!(size_of::<u32>(), 4);
    }
}
