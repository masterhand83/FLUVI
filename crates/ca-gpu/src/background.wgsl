struct WorldView { origin: vec2<f32>, span: vec2<f32> }
struct ZoneVertex { point: vec2<f32>, padding: vec2<f32>, color: vec4<f32> }
@group(0) @binding(0) var<uniform> view: WorldView;
@group(0) @binding(1) var<storage,read> vertices: array<ZoneVertex>;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) color: vec4<f32> }
@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> Vertex {
    let vertex=vertices[index];
    var out: Vertex;
    out.position=vec4<f32>((vertex.point-view.origin)/view.span*vec2<f32>(2,-2)+vec2<f32>(-1,1),0,1);
    out.color=vertex.color;
    return out;
}
@fragment
fn fs_main(in: Vertex) -> @location(0) vec4<f32> { return in.color; }
