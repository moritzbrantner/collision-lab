use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use wgpu::util::DeviceExt;

const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth24Plus;
const WORLD_EXTENT: f32 = 28.0;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Vertex {
    position: [f32; 3],
}

impl Vertex {
    const LAYOUT: wgpu::VertexBufferLayout<'static> = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &wgpu::vertex_attr_array![0 => Float32x3],
    };
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct InstanceRaw {
    center: [f32; 3],
    scale: [f32; 3],
}

impl InstanceRaw {
    const LAYOUT: wgpu::VertexBufferLayout<'static> = wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Instance,
        attributes: &wgpu::vertex_attr_array![1 => Float32x3, 2 => Float32x3],
    };
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct CameraUniform {
    view_proj: [[f32; 4]; 4],
}

const CUBE_VERTICES: [Vertex; 8] = [
    Vertex {
        position: [-0.5, -0.5, -0.5],
    },
    Vertex {
        position: [0.5, -0.5, -0.5],
    },
    Vertex {
        position: [0.5, 0.5, -0.5],
    },
    Vertex {
        position: [-0.5, 0.5, -0.5],
    },
    Vertex {
        position: [-0.5, -0.5, 0.5],
    },
    Vertex {
        position: [0.5, -0.5, 0.5],
    },
    Vertex {
        position: [0.5, 0.5, 0.5],
    },
    Vertex {
        position: [-0.5, 0.5, 0.5],
    },
];

const CUBE_INDICES: [u16; 36] = [
    0, 1, 2, 0, 2, 3, // back
    4, 6, 5, 4, 7, 6, // front
    0, 4, 5, 0, 5, 1, // bottom
    3, 2, 6, 3, 6, 7, // top
    1, 5, 6, 1, 6, 2, // right
    0, 3, 7, 0, 7, 4, // left
];

#[wasm_bindgen]
pub struct WgpuRenderer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    instance_buffer: wgpu::Buffer,
    camera_buffer: wgpu::Buffer,
    camera_bind_group: wgpu::BindGroup,
    depth_texture: wgpu::Texture,
    depth_view: wgpu::TextureView,
    instances: Vec<InstanceRaw>,
    max_instances: usize,
}

#[wasm_bindgen]
pub async fn create_renderer(
    canvas: HtmlCanvasElement,
    width: u32,
    height: u32,
    max_instances: u32,
) -> Result<WgpuRenderer, JsValue> {
    console_error_panic_hook::set_once();

    let width = width.max(1);
    let height = height.max(1);
    let max_instances = usize::try_from(max_instances.max(1))
        .map_err(|_| JsValue::from_str("renderer instance capacity exceeds usize"))?;

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::BROWSER_WEBGPU,
        ..Default::default()
    });
    let surface: wgpu::Surface<'static> = instance
        .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
        .map_err(|error| JsValue::from_str(&format!("failed to create WebGPU surface: {error}")))?;
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            ..Default::default()
        })
        .await
        .map_err(|error| {
            JsValue::from_str(&format!("failed to request WebGPU adapter: {error}"))
        })?;
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("collision-lab browser wgpu device"),
            ..Default::default()
        })
        .await
        .map_err(|error| JsValue::from_str(&format!("failed to request WebGPU device: {error}")))?;

    let mut config = surface
        .get_default_config(&adapter, width, height)
        .ok_or_else(|| JsValue::from_str("WebGPU adapter cannot present to this canvas"))?;
    config.present_mode = wgpu::PresentMode::AutoVsync;
    surface.configure(&device, &config);

    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("collision-lab instanced box shader"),
        source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
    });
    let camera_uniform = camera_uniform(width, height);
    let camera_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("collision-lab camera uniform"),
        contents: bytemuck::bytes_of(&camera_uniform),
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
    });
    let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("collision-lab cube vertices"),
        contents: bytemuck::cast_slice(&CUBE_VERTICES),
        usage: wgpu::BufferUsages::VERTEX,
    });
    let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("collision-lab cube indices"),
        contents: bytemuck::cast_slice(&CUBE_INDICES),
        usage: wgpu::BufferUsages::INDEX,
    });
    let instance_buffer_size = max_instances
        .checked_mul(std::mem::size_of::<InstanceRaw>())
        .and_then(|bytes| u64::try_from(bytes).ok())
        .ok_or_else(|| JsValue::from_str("renderer instance buffer size overflow"))?;
    let instance_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("collision-lab instance buffer"),
        size: instance_buffer_size.max(4),
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("collision-lab browser wgpu pipeline"),
        layout: None,
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            compilation_options: Default::default(),
            buffers: &[Some(Vertex::LAYOUT), Some(InstanceRaw::LAYOUT)],
        },
        primitive: wgpu::PrimitiveState {
            cull_mode: None,
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: DEPTH_FORMAT,
            depth_write_enabled: Some(true),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: Default::default(),
            bias: Default::default(),
        }),
        multisample: Default::default(),
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: config.format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    });
    let camera_bind_group_layout = pipeline.get_bind_group_layout(0);
    let camera_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("collision-lab camera bind group"),
        layout: &camera_bind_group_layout,
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: camera_buffer.as_entire_binding(),
        }],
    });
    let (depth_texture, depth_view) = create_depth_resources(&device, width, height);

    Ok(WgpuRenderer {
        surface,
        device,
        queue,
        config,
        pipeline,
        vertex_buffer,
        index_buffer,
        instance_buffer,
        camera_buffer,
        camera_bind_group,
        depth_texture,
        depth_view,
        instances: Vec::with_capacity(max_instances),
        max_instances,
    })
}

#[wasm_bindgen]
impl WgpuRenderer {
    pub fn resize(&mut self, width: u32, height: u32) {
        let width = width.max(1);
        let height = height.max(1);
        if self.config.width == width && self.config.height == height {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
        (self.depth_texture, self.depth_view) = create_depth_resources(&self.device, width, height);
        self.queue.write_buffer(
            &self.camera_buffer,
            0,
            bytemuck::bytes_of(&camera_uniform(width, height)),
        );
    }

    pub fn render(&mut self, packed_instances: &[f32]) -> Result<(), JsValue> {
        if !packed_instances.len().is_multiple_of(6) {
            return Err(JsValue::from_str(
                "instance data must contain center xyz and scale xyz for each body",
            ));
        }

        let instance_count = packed_instances.len() / 6;
        if instance_count > self.max_instances {
            return Err(JsValue::from_str(&format!(
                "instance count {instance_count} exceeds renderer capacity {}",
                self.max_instances
            )));
        }

        self.instances.clear();
        self.instances
            .extend(packed_instances.chunks_exact(6).map(|values| InstanceRaw {
                center: [values[0], values[1], values[2]],
                scale: [values[3], values[4], values[5]],
            }));
        if !self.instances.is_empty() {
            self.queue.write_buffer(
                &self.instance_buffer,
                0,
                bytemuck::cast_slice(&self.instances),
            );
        }

        let surface_texture = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture)
            | wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(());
            }
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                return Err(JsValue::from_str("WebGPU surface validation failed"));
            }
        };
        let view = surface_texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("collision-lab browser wgpu encoder"),
            });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("collision-lab browser wgpu pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.047,
                            g: 0.051,
                            b: 0.063,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.camera_bind_group, &[]);
            pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            if instance_count > 0 {
                pass.set_vertex_buffer(1, self.instance_buffer.slice(..));
            }
            pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
            if instance_count > 0 {
                pass.draw_indexed(0..CUBE_INDICES.len() as u32, 0, 0..instance_count as u32);
            }
        }

        self.queue.submit(Some(encoder.finish()));
        self.queue.present(surface_texture);
        Ok(())
    }
}

fn camera_uniform(width: u32, height: u32) -> CameraUniform {
    let aspect = width as f32 / height.max(1) as f32;
    let eye = Vec3::new(
        WORLD_EXTENT * 1.45,
        WORLD_EXTENT * 1.15,
        WORLD_EXTENT * 1.45,
    );
    let view = Mat4::look_at_rh(eye, Vec3::ZERO, Vec3::Y);
    let projection = Mat4::perspective_rh(48.0_f32.to_radians(), aspect, 0.1, 500.0);
    CameraUniform {
        view_proj: (projection * view).to_cols_array_2d(),
    }
}

fn create_depth_resources(
    device: &wgpu::Device,
    width: u32,
    height: u32,
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("collision-lab browser wgpu depth"),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: DEPTH_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}
