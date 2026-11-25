struct Dimensions { width: u32, height: u32, padding: vec2<u32> }
@group(0) @binding(0) var<uniform> dims: Dimensions;
@group(0) @binding(1) var<storage, read> cells: array<u32>;
@group(0) @binding(4) var<storage, read_write> population: atomic<u32>;
var<workgroup> partial: array<u32, 64>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) lane: u32) {
    var value = 0u;
    if id.x < dims.width && id.y < dims.height { value = cells[id.y * dims.width + id.x]; }
    partial[lane] = value;
    workgroupBarrier();
    var stride = 32u;
    loop {
        if lane < stride { partial[lane] += partial[lane + stride]; }
        workgroupBarrier();
        if stride == 1u { break; }
        stride /= 2u;
    }
    if lane == 0u { atomicAdd(&population, partial[0]); }
}
