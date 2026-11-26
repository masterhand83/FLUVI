struct Vertex {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) opacity: f32,
}
@group(0) @binding(0) var artwork: texture_2d<f32>;
@group(0) @binding(1) var artwork_sampler: sampler;

@vertex fn vs_main(
    @location(0) point: vec2<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) opacity: f32,
) -> Vertex {
    var result: Vertex;
    result.position = vec4<f32>(point, 0., 1.);
    result.uv = uv;
    result.opacity = opacity;
    return result;
}
@fragment fn fs_main(vertex: Vertex) -> @location(0) vec4<f32> {
    let color = textureSample(artwork, artwork_sampler, vertex.uv);
    return vec4<f32>(color.rgb, color.a * vertex.opacity);
}
