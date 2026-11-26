struct WorldView { origin: vec2<f32>, span: vec2<f32> }
struct Tile {
    center: vec2<f32>, axis: vec2<f32>,
    offset: u32, street_type: u32, direction: u32, lane_and_arrow: u32
}
struct HeatLane { offset: u32, length: u32, periodic: u32, padding: u32 }
override HEAT_MODE: bool = false;
@group(0) @binding(0) var<uniform> view: WorldView;
@group(0) @binding(1) var<storage, read> cells: array<u32>;
@group(0) @binding(2) var<storage, read> tiles: array<Tile>;
@group(0) @binding(3) var<storage, read> heat_lanes: array<HeatLane>;
struct Vertex {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) @interpolate(flat) instance: u32,
    @location(2) @interpolate(flat) heat_colour: vec3<f32>,
}
fn heat_colour(tile: Tile) -> vec3<f32> {
    let lane = heat_lanes[tile.lane_and_arrow >> 1u];
    let physical = tile.offset - lane.offset;
    var start = physical - min(physical, 2u);
    let end = min(physical + 3u, lane.length);
    var count = end - start;
    if lane.periodic != 0u {
        start = (physical + lane.length - (2u % lane.length)) % lane.length;
        count = min(5u, lane.length);
    }
    var vehicles = 0u;
    var index = start;
    for (var i = 0u; i < count; i++) {
        let value = cells[lane.offset + index] & 255u;
        vehicles += select(0u, 1u, value >= 1u && value <= 6u);
        index += 1u;
        if index == lane.length { index = 0u; }
    }
    let density = f32(vehicles) / f32(count);
    return vec3<f32>(min(2.0 * density, 1.0), min(2.0 - 2.0 * density, 1.0) * (220.0 / 255.0), 40.0 / 255.0);
}
@vertex
fn vs_main(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32) -> Vertex {
    let corners = array<vec2<f32>,6>(
        vec2<f32>(0,0),vec2<f32>(1,0),vec2<f32>(0,1),
        vec2<f32>(0,1),vec2<f32>(1,0),vec2<f32>(1,1));
    let uv = corners[index];
    let tile = tiles[instance];
    let arrow = (tile.lane_and_arrow & 1u) == 1u;
    let size = select(1.0, 1.4, arrow);
    let p = tile.center + tile.axis * (uv.x-0.5) * size
        + vec2<f32>(-tile.axis.y,tile.axis.x) * (uv.y-0.5);
    var out: Vertex;
    out.position = vec4<f32>(((p-view.origin)/view.span) * vec2<f32>(2,-2) + vec2<f32>(-1,1),0,1);
    out.uv = uv;
    out.instance = instance;
    out.heat_colour = vec3<f32>(0);
    if HEAT_MODE && !arrow {
        let value = cells[tile.offset] & 255u;
        if value >= 1u && value <= 6u {
            out.heat_colour = heat_colour(tile);
        }
    }
    return out;
}
fn vehicle_colour(value: u32) -> vec3<f32> {
    switch value {
        case 1u: { return vec3<f32>(0.95,0.18,0.17); }
        case 2u: { return vec3<f32>(1.0,0.65,0.08); }
        case 3u: { return vec3<f32>(0.95,0.9,0.15); }
        case 4u: { return vec3<f32>(0.12,0.85,0.35); }
        case 5u: { return vec3<f32>(0.1,0.6,1.0); }
        case 6u: { return vec3<f32>(0.8,0.25,0.95); }
        default: { return vec3<f32>(0.95); }
    }
}
// Procedural obstacle textures stay sharp at every map zoom.
// Mark IDs match Disruption's stable repr(u8), packed above the cell value.
fn disruption_colour(mark: u32, uv: vec2<f32>) -> vec3<f32> {
    let x = uv.x;
    let y = uv.y;
    switch mark {
        case 2u: { // flood: blue water with light wave crests
            let wave = sin(x * 24.0 + sin(y * 19.0) * 2.0);
            return select(vec3<f32>(0.07,0.4,0.78),vec3<f32>(0.4,0.8,1.0),wave > 0.83);
        }
        case 3u: { // pothole: irregular dark center and stone rim
            let radius = length((uv-vec2<f32>(0.5))*vec2<f32>(1.0,1.4));
            return select(vec3<f32>(0.36,0.30,0.24),vec3<f32>(0.06,0.045,0.035),
                radius < 0.32 + 0.03*sin(x*50.0));
        }
        case 4u: { // worker: helmet, high-visibility vest, and boots
            if length(uv-vec2<f32>(0.5,0.29)) < 0.14 { return vec3<f32>(1.0,0.85,0.1); }
            if abs(x-0.5)<0.18 && y>0.40 && y<0.68 { return vec3<f32>(1.0,0.5,0.05); }
            if y>0.68 && y<0.9 && (abs(x-0.4)<0.07 || abs(x-0.6)<0.07) {
                return vec3<f32>(0.15,0.25,0.4);
            }
            return vec3<f32>(0.11,0.12,0.14);
        }
        case 5u: { // tree: green crown and brown trunk
            if length((uv-vec2<f32>(0.5,0.4))*vec2<f32>(1.0,0.9))<0.30 {
                return vec3<f32>(0.1,0.65,0.22);
            }
            if abs(x-0.5)<0.07 && y>0.4 { return vec3<f32>(0.45,0.25,0.09); }
            return vec3<f32>(0.11,0.12,0.14);
        }
        case 6u: { // cone: orange triangle, reflective band, and base
            if (y>0.18 && abs(x-0.5)<(y-0.15)*0.40) || (y>0.80 && y<0.9 && abs(x-0.5)<0.35) {
                return select(vec3<f32>(1.0,0.38,0.03),vec3<f32>(0.95),y>0.43 && y<0.55);
            }
            return vec3<f32>(0.11,0.12,0.14);
        }
        default: { // lane barrier
            return select(vec3<f32>(0.06),vec3<f32>(1.0,0.8,0.1),fract((x+y)*4.0)<0.5);
        }
    }
}
@fragment
fn fs_main(in: Vertex) -> @location(0) vec4<f32> {
    let tile = tiles[in.instance];
    let x = in.uv.x;
    let y = in.uv.y;
    if (tile.lane_and_arrow & 1u) == 1u {
        let dx = (x-0.5)*1.4*select(-1.0,1.0,tile.direction == 1u);
        let dy = abs(y-0.5);
        if !((abs(dx)<0.5 && dy<0.055) ||
             (dx>0.0 && dx<0.5 && abs(dy-(0.5-dx)*0.55)<0.07)) { discard; }
        return vec4<f32>(0.7,0.8,0.9,1);
    }
    var colour = vec3<f32>(0.085,0.10,0.13);
    if y < 0.04 || y > 0.96 {
        colour = select(vec3<f32>(0.35,0.55,0.7),vec3<f32>(0.25,0.7,0.45),tile.street_type==0u);
        if tile.street_type==2u { colour = vec3<f32>(0.8,0.4,0.3); }
    }
    let packed = cells[tile.offset];
    let value = packed & 255u;
    if HEAT_MODE && value >= 1u && value <= 6u {
        if abs(x - 0.5) < 0.34 && abs(y - 0.5) < 0.34 {
            colour = in.heat_colour;
        }
        return vec4<f32>(colour, 1);
    }
    if value!=0u && x>0.1 && x<0.9 && y>0.16 && y<0.84 {
        colour = vehicle_colour(value);
        if value==7u {
            if packed >> 8u != 0u { colour=disruption_colour(packed >> 8u, in.uv); }
            else if abs(x-y)<0.12 { colour=vec3<f32>(0.05); }
        }
    }
    return vec4<f32>(colour,1);
}
