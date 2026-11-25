struct Dimensions { width: u32, height: u32, padding: vec2<u32> }
@group(0) @binding(0) var<uniform> dims: Dimensions;
@group(0) @binding(1) var<storage, read> cells: array<u32>;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> Vertex {
    let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    var out: Vertex;
    out.position = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
    out.uv = uv;
    return out;
}
@fragment
fn fs_main(in: Vertex) -> @location(0) vec4<f32> {
    // Integer lookup is nearest-neighbor sampling; no texture or readback.
    let xy = min(vec2<u32>(in.uv * vec2<f32>(f32(dims.width), f32(dims.height))),
                 vec2<u32>(dims.width - 1u, dims.height - 1u));
    let alive = cells[xy.y * dims.width + xy.x] != 0u;
    return vec4<f32>(select(vec3<f32>(0.018, 0.025, 0.04), vec3<f32>(0.25, 0.85, 0.55), alive), 1.0);
}
