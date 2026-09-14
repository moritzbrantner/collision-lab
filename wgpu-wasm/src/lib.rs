use std::sync::{Arc, Mutex};

use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3};
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;
use wgpu::util::DeviceExt;

const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth24Plus;
const WORLD_EXTENT: f32 = 28.0;
const GPU_QUERY_COUNT: u32 = 2;
const GPU_QUERY_BYTES: u64 = GPU_QUERY_COUNT as u64 * wgpu::QUERY_SIZE as u64;

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

struct GpuTimer {
    query_set: wgpu::QuerySet,
    resolve_buffer: wgpu::Buffer,
    readback_buffer: wgpu::Buffer,
    timestamp_period_ns: f64,
    map_result: Arc<Mutex<Option<Result<(), String>>>>,
    pending: bool,
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
    gpu_timer: Option<GpuTimer>,
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

    let mut instance_descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
    instance_descriptor.backends = wgpu::Backends::BROWSER_WEBGPU;
    let instance = wgpu::Instance::new(instance_descriptor);
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
    let timestamp_supported = adapter.features().contains(wgpu::Features::TIMESTAMP_QUERY);
    let required_features = if timestamp_supported {
        wgpu::Features::TIMESTAMP_QUERY
    } else {
        wgpu::Features::empty()
    };
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("collision-lab browser wgpu device"),
            required_features,
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
    let gpu_timer = timestamp_supported.then(|| create_gpu_timer(&device, &queue));

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
        gpu_timer,
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
        let instance_count = self.update_instances(packed_instances)?;
        self.submit_frame(instance_count, false)?;
        Ok(())
    }

    pub fn gpu_timing_supported(&self) -> bool {
        self.gpu_timer.is_some()
    }

    pub fn begin_gpu_measurement(&mut self, packed_instances: &[f32]) -> Result<bool, JsValue> {
        let Some(timer) = self.gpu_timer.as_ref() else {
            return Ok(false);
        };
        if timer.pending {
            return Err(JsValue::from_str(
                "a GPU timing measurement is already pending",
            ));
        }

        let instance_count = self.update_instances(packed_instances)?;
        if !self.submit_frame(instance_count, true)? {
            return Ok(false);
        }

        let timer = self
            .gpu_timer
            .as_mut()
            .ok_or_else(|| JsValue::from_str("GPU timer disappeared during measurement"))?;
        *timer
            .map_result
            .lock()
            .map_err(|_| JsValue::from_str("GPU timing map state was poisoned"))? = None;
        let map_result = Arc::clone(&timer.map_result);
        timer
            .readback_buffer
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                if let Ok(mut state) = map_result.lock() {
                    *state = Some(result.map_err(|error| error.to_string()));
                }
            });
        timer.pending = true;
        Ok(true)
    }

    pub fn poll_gpu_measurement(&mut self) -> Result<Option<f64>, JsValue> {
        let Some(timer) = self.gpu_timer.as_mut() else {
            return Ok(None);
        };
        if !timer.pending {
            return Ok(None);
        }

        let result = timer
            .map_result
            .lock()
            .map_err(|_| JsValue::from_str("GPU timing map state was poisoned"))?
            .take();
        let Some(result) = result else {
            return Ok(None);
        };
        result
            .map_err(|error| JsValue::from_str(&format!("GPU timing readback failed: {error}")))?;

        let view = timer.readback_buffer.slice(..).get_mapped_range();
        if view.len() < GPU_QUERY_BYTES as usize {
            drop(view);
            timer.readback_buffer.unmap();
            timer.pending = false;
            return Err(JsValue::from_str(
                "GPU timing readback was shorter than two timestamps",
            ));
        }
        let start = u64::from_le_bytes(
            view[0..8]
                .try_into()
                .map_err(|_| JsValue::from_str("invalid GPU timing start timestamp"))?,
        );
        let end = u64::from_le_bytes(
            view[8..16]
                .try_into()
                .map_err(|_| JsValue::from_str("invalid GPU timing end timestamp"))?,
        );
        drop(view);
        timer.readback_buffer.unmap();
        timer.pending = false;
        if end < start {
            return Err(JsValue::from_str(
                "GPU timing end timestamp preceded its start",
            ));
        }
        let elapsed_ms = (end - start) as f64 * timer.timestamp_period_ns / 1_000_000.0;
        Ok(Some(elapsed_ms))
    }
}

impl WgpuRenderer {
    fn update_instances(&mut self, packed_instances: &[f32]) -> Result<usize, JsValue> {
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
        Ok(instance_count)
    }

    fn submit_frame(&mut self, instance_count: usize, timed: bool) -> Result<bool, JsValue> {
        let surface_texture = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(texture)
            | wgpu::CurrentSurfaceTexture::Suboptimal(texture) => texture,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(false);
            }
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.device, &self.config);
                return Ok(false);
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

        let timestamp_writes = if timed {
            self.gpu_timer
                .as_ref()
                .map(|timer| wgpu::RenderPassTimestampWrites {
                    query_set: &timer.query_set,
                    beginning_of_pass_write_index: Some(0),
                    end_of_pass_write_index: Some(1),
                })
        } else {
            None
        };
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
                timestamp_writes,
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

        if timed {
            if let Some(timer) = self.gpu_timer.as_ref() {
                encoder.resolve_query_set(
                    &timer.query_set,
                    0..GPU_QUERY_COUNT,
                    &timer.resolve_buffer,
                    0,
                );
                encoder.copy_buffer_to_buffer(
                    &timer.resolve_buffer,
                    0,
                    &timer.readback_buffer,
                    0,
                    GPU_QUERY_BYTES,
                );
            }
        }
        self.queue.submit(Some(encoder.finish()));
        self.queue.present(surface_texture);
        Ok(true)
    }
}

fn create_gpu_timer(device: &wgpu::Device, queue: &wgpu::Queue) -> GpuTimer {
    let query_set = device.create_query_set(&wgpu::QuerySetDescriptor {
        label: Some("collision-lab browser wgpu timestamp queries"),
        ty: wgpu::QueryType::Timestamp,
        count: GPU_QUERY_COUNT,
    });
    let resolve_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("collision-lab browser wgpu timestamp resolve"),
        size: GPU_QUERY_BYTES,
        usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let readback_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("collision-lab browser wgpu timestamp readback"),
        size: GPU_QUERY_BYTES,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    GpuTimer {
        query_set,
        resolve_buffer,
        readback_buffer,
        timestamp_period_ns: f64::from(queue.get_timestamp_period()),
        map_result: Arc::new(Mutex::new(None)),
        pending: false,
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
