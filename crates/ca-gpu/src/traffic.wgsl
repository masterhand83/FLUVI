struct WorldView { origin: vec2<f32>, span: vec2<f32> }
struct Tile {
    center: vec2<f32>, axis: vec2<f32>,
    offset: u32, street_type: u32, direction: u32, arrow: u32
}
@group(0) @binding(0) var<uniform> view: WorldView;
@group(0) @binding(1) var<storage, read> cells: array<u32>;
@group(0) @binding(2) var<storage, read> tiles: array<Tile>;
struct Vertex {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) @interpolate(flat) instance: u32,
}
@vertex
fn vs_main(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32) -> Vertex {
    let corners = array<vec2<f32>,6>(
        vec2<f32>(0,0),vec2<f32>(1,0),vec2<f32>(0,1),
        vec2<f32>(0,1),vec2<f32>(1,0),vec2<f32>(1,1));
    let uv = corners[index];
    let tile = tiles[instance];
    let size = select(1.0, 1.4, tile.arrow == 1u);
    let p = tile.center + tile.axis * (uv.x-0.5) * size
        + vec2<f32>(-tile.axis.y,tile.axis.x) * (uv.y-0.5);
    var out: Vertex;
    out.position = vec4<f32>(((p-view.origin)/view.span) * vec2<f32>(2,-2) + vec2<f32>(-1,1),0,1);
    out.uv = uv;
    out.instance = instance;
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
@fragment
fn fs_main(in: Vertex) -> @location(0) vec4<f32> {
    let tile = tiles[in.instance];
    let x = in.uv.x;
    let y = in.uv.y;
    if tile.arrow == 1u {
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
    let value = cells[tile.offset];
    if value!=0u && x>0.1 && x<0.9 && y>0.16 && y<0.84 {
        colour = vehicle_colour(value);
        if value==7u && abs(x-y)<0.12 { colour=vec3<f32>(0.05); }
    }
    return vec4<f32>(colour,1);
}
