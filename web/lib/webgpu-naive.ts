/// <reference types="@webgpu/types" />

const WORKGROUP_SIZE = 8;

const SHADER = /* wgsl */ `
struct Aabb {
  min: vec4<f32>,
  max: vec4<f32>,
}

struct Params {
  object_count: u32,
  word_count: u32,
  _padding0: u32,
  _padding1: u32,
}

@group(0) @binding(0) var<storage, read> aabbs: array<Aabb>;
@group(0) @binding(1) var<storage, read_write> hits: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;

fn overlaps(left: Aabb, right: Aabb) -> bool {
  return left.min.x <= right.max.x && left.max.x >= right.min.x
    && left.min.y <= right.max.y && left.max.y >= right.min.y
    && left.min.z <= right.max.z && left.max.z >= right.min.z;
}

fn pair_index(left: u32, right: u32, count: u32) -> u32 {
  return (left * (2u * count - left - 1u)) / 2u + (right - left - 1u);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let left = id.x;
  let right = id.y;
  if (left >= params.object_count || right >= params.object_count || left >= right) {
    return;
  }

  if (overlaps(aabbs[left], aabbs[right])) {
    let index = pair_index(left, right, params.object_count);
    let word = index / 32u;
    if (word < params.word_count) {
      atomicOr(&hits[word], 1u << (index % 32u));
    }
  }
}
`;

export type WebGpuNaiveMeasurement = {
  bitset: Uint32Array;
  overlaps: number;
  prepareUploadMs: number;
  computeMs: number | null;
  submitReadbackMs: number;
  decodeMs: number;
  totalMs: number;
};

export type WebGpuNaiveRunner = {
  setupMs: number;
  timestampSupported: boolean;
  run(aabbs: Float32Array<ArrayBuffer>, objectCount: number): Promise<WebGpuNaiveMeasurement>;
  destroy(): void;
};

export async function createWebGpuNaiveRunner(): Promise<WebGpuNaiveRunner> {
  if (!("gpu" in navigator)) {
    throw new Error("WebGPU is not available in this browser.");
  }

  const setupStarted = performance.now();
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    throw new Error("The browser exposes WebGPU, but no GPU adapter is available.");
  }

  const timestampSupported = adapter.features.has("timestamp-query");
  const requiredFeatures: GPUFeatureName[] = timestampSupported ? ["timestamp-query"] : [];
  const device = await adapter.requestDevice({ requiredFeatures });
  const module = device.createShaderModule({ label: "collision-lab naive all-pairs", code: SHADER });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter(
    (message: GPUCompilationMessage) => message.type === "error",
  );
  if (errors.length > 0) {
    device.destroy();
    throw new Error(
      `WebGPU shader compilation failed: ${errors.map((message: GPUCompilationMessage) => message.message).join(" | ")}`,
    );
  }

  const pipeline = await device.createComputePipelineAsync({
    label: "collision-lab naive all-pairs",
    layout: "auto",
    compute: { module, entryPoint: "main" },
  });
  const setupMs = performance.now() - setupStarted;

  return {
    setupMs,
    timestampSupported,
    async run(aabbs, objectCount) {
      if (!Number.isInteger(objectCount) || objectCount < 0 || objectCount > 65_536) {
        throw new Error("The current u32 triangular pair index supports 0 to 65,536 objects.");
      }
      if (aabbs.length !== objectCount * 8) {
        throw new Error(`Expected ${objectCount * 8} packed AABB floats, received ${aabbs.length}.`);
      }

      const possiblePairs = (objectCount * (objectCount - 1)) / 2;
      if (possiblePairs > 0xffff_ffff) {
        throw new Error("The current GPU pair-index encoding supports at most 2^32 - 1 possible pairs.");
      }

      const wordCount = Math.ceil(possiblePairs / 32);
      const outputBytes = Math.max(4, wordCount * Uint32Array.BYTES_PER_ELEMENT);
      const inputBytes = Math.max(32, aabbs.byteLength);
      if (inputBytes > device.limits.maxStorageBufferBindingSize) {
        throw new Error("The packed AABB input exceeds this device's storage-buffer binding limit.");
      }
      if (outputBytes > device.limits.maxStorageBufferBindingSize) {
        throw new Error("The pair bitset exceeds this device's storage-buffer binding limit.");
      }

      const totalStarted = performance.now();
      const prepareStarted = performance.now();
      const inputBuffer = device.createBuffer({
        label: "collision-lab AABBs",
        size: inputBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const outputBuffer = device.createBuffer({
        label: "collision-lab pair bitset",
        size: outputBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      });
      const readbackBuffer = device.createBuffer({
        label: "collision-lab pair readback",
        size: outputBytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const paramsBuffer = device.createBuffer({
        label: "collision-lab params",
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const params = new Uint32Array([objectCount, wordCount, 0, 0]);
      device.queue.writeBuffer(inputBuffer, 0, aabbs);
      device.queue.writeBuffer(paramsBuffer, 0, params);
      const bindGroup = device.createBindGroup({
        label: "collision-lab naive all-pairs",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: outputBuffer } },
          { binding: 2, resource: { buffer: paramsBuffer } },
        ],
      });

      let querySet: GPUQuerySet | null = null;
      let queryResolveBuffer: GPUBuffer | null = null;
      let queryReadbackBuffer: GPUBuffer | null = null;
      if (timestampSupported) {
        querySet = device.createQuerySet({ type: "timestamp", count: 2 });
        queryResolveBuffer = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        });
        queryReadbackBuffer = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
      }
      const prepareUploadMs = performance.now() - prepareStarted;

      try {
        const encoder = device.createCommandEncoder({ label: "collision-lab naive all-pairs" });
        encoder.clearBuffer(outputBuffer);
        const pass = encoder.beginComputePass(
          querySet
            ? {
                timestampWrites: {
                  querySet,
                  beginningOfPassWriteIndex: 0,
                  endOfPassWriteIndex: 1,
                },
              }
            : undefined,
        );
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        const workgroups = Math.ceil(objectCount / WORKGROUP_SIZE);
        if (workgroups > device.limits.maxComputeWorkgroupsPerDimension) {
          throw new Error("The object count exceeds this device's compute-workgroup dimension limit.");
        }
        pass.dispatchWorkgroups(workgroups, workgroups, 1);
        pass.end();

        encoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, outputBytes);
        if (querySet && queryResolveBuffer && queryReadbackBuffer) {
          encoder.resolveQuerySet(querySet, 0, 2, queryResolveBuffer, 0);
          encoder.copyBufferToBuffer(queryResolveBuffer, 0, queryReadbackBuffer, 0, 16);
        }

        const submitStarted = performance.now();
        device.queue.submit([encoder.finish()]);
        const mappings: Promise<void>[] = [readbackBuffer.mapAsync(GPUMapMode.READ)];
        if (queryReadbackBuffer) {
          mappings.push(queryReadbackBuffer.mapAsync(GPUMapMode.READ));
        }
        await Promise.all(mappings);
        const submitReadbackMs = performance.now() - submitStarted;

        const bitset = new Uint32Array(readbackBuffer.getMappedRange().slice(0));
        let computeMs: number | null = null;
        if (queryReadbackBuffer) {
          const timestamps = new BigUint64Array(queryReadbackBuffer.getMappedRange().slice(0));
          computeMs = Number(timestamps[1] - timestamps[0]) / 1_000_000;
        }

        const decodeStarted = performance.now();
        const overlaps = countSetBits(bitset);
        const decodeMs = performance.now() - decodeStarted;

        readbackBuffer.unmap();
        queryReadbackBuffer?.unmap();

        return {
          bitset,
          overlaps,
          prepareUploadMs,
          computeMs,
          submitReadbackMs,
          decodeMs,
          totalMs: performance.now() - totalStarted,
        };
      } finally {
        inputBuffer.destroy();
        outputBuffer.destroy();
        readbackBuffer.destroy();
        paramsBuffer.destroy();
        querySet?.destroy();
        queryResolveBuffer?.destroy();
        queryReadbackBuffer?.destroy();
      }
    },
    destroy() {
      device.destroy();
    },
  };
}

function countSetBits(values: Uint32Array) {
  let count = 0;
  for (const value of values) {
    let remaining = value;
    while (remaining !== 0) {
      remaining &= remaining - 1;
      count += 1;
    }
  }
  return count;
}
