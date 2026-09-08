struct Camera {
    view_proj: mat4x4<f32>,
};

@group(0) @binding(0)
var<uniform> camera: Camera;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) center: vec3<f32>,
    @location(2) scale: vec3<f32>,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    let world_position = input.position * input.scale + input.center;
    output.clip_position = camera.view_proj * vec4<f32>(world_position, 1.0);
    output.world_position = world_position;
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let depth_tint = clamp((input.world_position.y + 28.0) / 56.0, 0.0, 1.0);
    let low = vec3<f32>(0.22, 0.64, 0.70);
    let high = vec3<f32>(0.40, 0.91, 0.98);
    return vec4<f32>(mix(low, high, depth_tint), 1.0);
}
