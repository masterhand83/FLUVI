struct Dimensions { width: u32, height: u32, padding: vec2<u32> }
@group(0) @binding(0) var<uniform> dims: Dimensions;
@group(0) @binding(1) var<storage, read> source: array<u32>;
@group(0) @binding(2) var<storage, read_write> destination: array<u32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= dims.width || id.y >= dims.height { return; }
    var neighbors = 0u;
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            if dx == 0 && dy == 0 { continue; }
            let x = u32((i32(id.x) + dx + i32(dims.width)) % i32(dims.width));
            let y = u32((i32(id.y) + dy + i32(dims.height)) % i32(dims.height));
            neighbors += source[y * dims.width + x];
        }
    }
    let index = id.y * dims.width + id.x;
    destination[index] = select(0u, 1u, neighbors == 3u || (neighbors == 2u && source[index] == 1u));
}
