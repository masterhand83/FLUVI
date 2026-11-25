struct Dimensions { width: u32, height: u32, padding: vec2<u32> }
struct Brush { center: vec2<i32>, radius: u32, value: u32 }
@group(0) @binding(0) var<uniform> dims: Dimensions;
@group(0) @binding(2) var<storage, read_write> cells: array<u32>;
@group(0) @binding(3) var<uniform> brush: Brush;

// A clipped Euclidean disc, inclusive boundary, integer cell centers.
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= dims.width || id.y >= dims.height { return; }
    let delta = vec2<i32>(id.xy) - brush.center;
    if dot(delta, delta) <= i32(brush.radius * brush.radius) {
        cells[id.y * dims.width + id.x] = brush.value;
    }
}
