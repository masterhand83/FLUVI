struct WorldView { origin: vec2<f32>, span: vec2<f32> }
struct Lane {
    origin: vec2<u32>, offset: u32, length: u32,
    direction: u32, street_type: u32, padding: vec2<u32>
}
@group(0) @binding(0) var<uniform> view: WorldView;
@group(0) @binding(1) var<storage, read> cells: array<u32>;
@group(0) @binding(2) var<storage, read> lanes: array<Lane>;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> Vertex {
    let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    var out: Vertex;
    out.position = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
    out.uv = uv;
    return out;
}

fn vehicle_colour(value: u32) -> vec3<f32> {
    switch value {
        case 1u: { return vec3<f32>(0.95, 0.18, 0.17); }
        case 2u: { return vec3<f32>(1.0, 0.65, 0.08); }
        case 3u: { return vec3<f32>(0.95, 0.9, 0.15); }
        case 4u: { return vec3<f32>(0.12, 0.85, 0.35); }
        case 5u: { return vec3<f32>(0.1, 0.6, 1.0); }
        case 6u: { return vec3<f32>(0.8, 0.25, 0.95); }
        default: { return vec3<f32>(0.95); }
    }
}

@fragment
fn fs_main(in: Vertex) -> @location(0) vec4<f32> {
    let p = view.origin + in.uv * view.span;
    var colour = vec3<f32>(0.018, 0.025, 0.04);
    for (var i = 0u; i < arrayLength(&lanes); i++) {
        let lane = lanes[i];
        let local = p - vec2<f32>(lane.origin);
        if local.y < 0.0 || local.y >= 1.0 { continue; }
        // Direction arrows in both gutters. Reverse changes the arrow, not indices.
        if (local.x > -1.7 && local.x < -0.3) ||
           (local.x > f32(lane.length) + 0.3 && local.x < f32(lane.length) + 1.7) {
            let center = select(f32(lane.length) + 1.0, -1.0, local.x < 0.0);
            let x = (local.x - center) * select(-1.0, 1.0, lane.direction == 1u);
            let y = abs(local.y - 0.5);
            if (abs(x) < 0.5 && y < 0.055) ||
               (x > 0.0 && x < 0.5 && abs(y - (0.5 - x) * 0.55) < 0.07) {
                colour = vec3<f32>(0.7, 0.8, 0.9);
            }
        }
        if local.x < 0.0 || local.x >= f32(lane.length) { continue; }
        colour = vec3<f32>(0.085, 0.10, 0.13);
        if local.y < 0.04 || local.y > 0.96 {
            colour = select(vec3<f32>(0.35, 0.55, 0.7), vec3<f32>(0.25, 0.7, 0.45), lane.street_type == 0u);
            if lane.street_type == 2u { colour = vec3<f32>(0.8, 0.4, 0.3); }
        }
        let value = cells[lane.offset + u32(local.x)];
        let x = fract(local.x);
        if value != 0u && x > 0.1 && x < 0.9 && local.y > 0.16 && local.y < 0.84 {
            colour = vehicle_colour(value);
            // Special value 7 has a black diagonal mark on white.
            if value == 7u && abs(x - local.y) < 0.12 { colour = vec3<f32>(0.05); }
        }
    }
    return vec4<f32>(colour, 1.0);
}
