/// <reference types="@webgpu/types" />

const WORKGROUP_SIZE = 64;
const MAX_OBJECTS = 65_536;

const BUILD_SHADER = /* wgsl */ `
struct CellRange {
  min: vec4<i32>,
  max: vec4<i32>,
}

struct Membership {
  body: u32,
  next: u32,
}

struct Stats {
  memberships: atomic<u32>,
  occupied_cells: atomic<u32>,
  aabb_tests: atomic<u32>,
  overflow: atomic<u32>,
}

struct Params {
  object_count: u32,
  word_count: u32,
  cell_count: u32,
  membership_capacity: u32,
  origin_x: i32,
  origin_y: i32,
  origin_z: i32,
  dim_x: u32,
  dim_y: u32,
  dim_z: u32,
  _padding0: u32,
  _padding1: u32,
}

@group(0) @binding(0) var<storage, read> ranges: array<CellRange>;
@group(0) @binding(1) var<storage, read_write> heads: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> memberships: array<Membership>;
@group(0) @binding(3) var<storage, read_write> stats: Stats;
@group(0) @binding(4) var<uniform> params: Params;

fn cell_index(x: i32, y: i32, z: i32) -> u32 {
  let local_x = u32(x - params.origin_x);
  let local_y = u32(y - params.origin_y);
  let local_z = u32(z - params.origin_z);
  return (local_x * params.dim_y + local_y) * params.dim_z + local_z;
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let body = id.x;
  if (body >= params.object_count) {
    return;
  }

  let range = ranges[body];
  for (var x = range.min.x; x <= range.max.x; x += 1) {
    for (var y = range.min.y; y <= range.max.y; y += 1) {
      for (var z = range.min.z; z <= range.max.z; z += 1) {
        let cell = cell_index(x, y, z);
        if (cell >= params.cell_count) {
          atomicStore(&stats.overflow, 1u);
          continue;
        }

        let slot = atomicAdd(&stats.memberships, 1u);
        if (slot >= params.membership_capacity) {
          atomicStore(&stats.overflow, 1u);
          continue;
        }

        let previous = atomicExchange(&heads[cell], slot + 1u);
        memberships[slot].body = body;
        memberships[slot].next = previous;
        if (previous == 0u) {
          atomicAdd(&stats.occupied_cells, 1u);
        }
      }
    }
  }
}
`;

const TEST_SHADER = /* wgsl */ `
struct Aabb {
  min: vec4<f32>,
  max: vec4<f32>,
}

struct CellRange {
  min: vec4<i32>,
  max: vec4<i32>,
}

struct Membership {
  body: u32,
  next: u32,
}

struct Stats {
  memberships: atomic<u32>,
  occupied_cells: atomic<u32>,
  aabb_tests: atomic<u32>,
  overflow: atomic<u32>,
}

struct Params {
  object_count: u32,
  word_count: u32,
  cell_count: u32,
  membership_capacity: u32,
  origin_x: i32,
  origin_y: i32,
  origin_z: i32,
  dim_x: u32,
  dim_y: u32,
  dim_z: u32,
  _padding0: u32,
  _padding1: u32,
}

@group(0) @binding(0) var<storage, read> aabbs: array<Aabb>;
@group(0) @binding(1) var<storage, read> ranges: array<CellRange>;
@group(0) @binding(2) var<storage, read_write> heads: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> memberships: array<Membership>;
@group(0) @binding(4) var<storage, read_write> tested: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> hits: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> stats: Stats;
@group(0) @binding(7) var<uniform> params: Params;

fn overlaps(left: Aabb, right: Aabb) -> bool {
  return left.min.x <= right.max.x && left.max.x >= right.min.x
    && left.min.y <= right.max.y && left.max.y >= right.min.y
    && left.min.z <= right.max.z && left.max.z >= right.min.z;
}

fn pair_index(left: u32, right: u32, count: u32) -> u32 {
  return (left * (2u * count - left - 1u)) / 2u + (right - left - 1u);
}

fn cell_index(x: i32, y: i32, z: i32) -> u32 {
  let local_x = u32(x - params.origin_x);
  let local_y = u32(y - params.origin_y);
  let local_z = u32(z - params.origin_z);
  return (local_x * params.dim_y + local_y) * params.dim_z + local_z;
}

fn test_pair(left: u32, right: u32) {
  let index = pair_index(left, right, params.object_count);
  let word = index / 32u;
  let mask = 1u << (index % 32u);
  if (word >= params.word_count) {
    atomicStore(&stats.overflow, 1u);
    return;
  }

  let previous = atomicOr(&tested[word], mask);
  if ((previous & mask) != 0u) {
    return;
  }

  atomicAdd(&stats.aabb_tests, 1u);
  if (overlaps(aabbs[left], aabbs[right])) {
    atomicOr(&hits[word], mask);
  }
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let body = id.x;
  if (body >= params.object_count) {
    return;
  }

  let range = ranges[body];
  for (var x = range.min.x; x <= range.max.x; x += 1) {
    for (var y = range.min.y; y <= range.max.y; y += 1) {
      for (var z = range.min.z; z <= range.max.z; z += 1) {
        let cell = cell_index(x, y, z);
        if (cell >= params.cell_count) {
          atomicStore(&stats.overflow, 1u);
          continue;
        }

        var head = atomicLoad(&heads[cell]);
        loop {
          if (head == 0u) {
            break;
          }
          let membership = memberships[head - 1u];
          let other = membership.body;
          if (body < other) {
            test_pair(body, other);
          }
          head = membership.next;
        }
      }
    }
  }
}
`;

export type WebGpuGridMeasurement = {
  bitset: Uint32Array;
  overlaps: number;
  aabbTests: number;
  occupiedCells: number;
  memberships: number;
  prepareUploadMs: number;
  computeMs: number | null;
  buildPassMs: number | null;
  testPassMs: number | null;
  submitReadbackMs: number;
  decodeMs: number;
  totalMs: number;
};

export type WebGpuGridRunner = {
  setupMs: number;
  timestampSupported: boolean;
  run(
    aabbs: Float32Array<ArrayBuffer>,
    objectCount: number,
    cellSize: number,
  ): Promise<WebGpuGridMeasurement>;
  destroy(): void;
};

type GridLayout = {
  ranges: Int32Array<ArrayBuffer>;
  origin: [number, number, number];
  dimensions: [number, number, number];
  cellCount: number;
  membershipCapacity: number;
};

export async function createWebGpuGridRunner(): Promise<WebGpuGridRunner> {
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

  const buildModule = device.createShaderModule({
    label: "collision-lab uniform-grid build",
    code: BUILD_SHADER,
  });
  const testModule = device.createShaderModule({
    label: "collision-lab uniform-grid test",
    code: TEST_SHADER,
  });
  await assertShaderCompiles(buildModule, "uniform-grid build");
  await assertShaderCompiles(testModule, "uniform-grid test");

  const [buildPipeline, testPipeline] = await Promise.all([
    device.createComputePipelineAsync({
      label: "collision-lab uniform-grid build",
      layout: "auto",
      compute: { module: buildModule, entryPoint: "main" },
    }),
    device.createComputePipelineAsync({
      label: "collision-lab uniform-grid test",
      layout: "auto",
      compute: { module: testModule, entryPoint: "main" },
    }),
  ]);
  const setupMs = performance.now() - setupStarted;

  return {
    setupMs,
    timestampSupported,
    async run(aabbs, objectCount, cellSize) {
      validateInputs(aabbs, objectCount, cellSize);

      const totalStarted = performance.now();
      const prepareStarted = performance.now();
      const layout = buildGridLayout(aabbs, objectCount, cellSize);
      const possiblePairs = (objectCount * (objectCount - 1)) / 2;
      const wordCount = Math.ceil(possiblePairs / 32);
      const bitsetBytes = Math.max(4, wordCount * Uint32Array.BYTES_PER_ELEMENT);
      const inputBytes = Math.max(32, aabbs.byteLength);
      const rangesBytes = Math.max(32, layout.ranges.byteLength);
      const headsBytes = Math.max(4, layout.cellCount * Uint32Array.BYTES_PER_ELEMENT);
      const membershipsBytes = Math.max(8, layout.membershipCapacity * 8);

      for (const [label, bytes] of [
        ["packed AABB input", inputBytes],
        ["cell-range input", rangesBytes],
        ["cell heads", headsBytes],
        ["cell memberships", membershipsBytes],
        ["pair bitset", bitsetBytes],
      ] as const) {
        if (bytes > device.limits.maxStorageBufferBindingSize) {
          throw new Error(`The ${label} exceeds this device's storage-buffer binding limit.`);
        }
      }

      const workgroups = Math.ceil(objectCount / WORKGROUP_SIZE);
      if (workgroups > device.limits.maxComputeWorkgroupsPerDimension) {
        throw new Error("The object count exceeds this device's compute-workgroup dimension limit.");
      }

      const inputBuffer = createBuffer(device, "grid AABBs", inputBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const rangesBuffer = createBuffer(device, "grid cell ranges", rangesBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const headsBuffer = createBuffer(device, "grid cell heads", headsBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const membershipsBuffer = createBuffer(device, "grid memberships", membershipsBytes, GPUBufferUsage.STORAGE);
      const testedBuffer = createBuffer(device, "grid tested pairs", bitsetBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const outputBuffer = createBuffer(device, "grid overlap bitset", bitsetBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
      const statsBuffer = createBuffer(device, "grid stats", 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
      const paramsBuffer = createBuffer(device, "grid params", 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const outputReadback = createBuffer(device, "grid overlap readback", bitsetBytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
      const statsReadback = createBuffer(device, "grid stats readback", 16, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);

      const params = buildParamsBuffer(objectCount, wordCount, layout);
      device.queue.writeBuffer(inputBuffer, 0, aabbs);
      device.queue.writeBuffer(rangesBuffer, 0, layout.ranges);
      device.queue.writeBuffer(paramsBuffer, 0, params);

      const buildBindGroup = device.createBindGroup({
        label: "collision-lab uniform-grid build",
        layout: buildPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: rangesBuffer } },
          { binding: 1, resource: { buffer: headsBuffer } },
          { binding: 2, resource: { buffer: membershipsBuffer } },
          { binding: 3, resource: { buffer: statsBuffer } },
          { binding: 4, resource: { buffer: paramsBuffer } },
        ],
      });
      const testBindGroup = device.createBindGroup({
        label: "collision-lab uniform-grid test",
        layout: testPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: rangesBuffer } },
          { binding: 2, resource: { buffer: headsBuffer } },
          { binding: 3, resource: { buffer: membershipsBuffer } },
          { binding: 4, resource: { buffer: testedBuffer } },
          { binding: 5, resource: { buffer: outputBuffer } },
          { binding: 6, resource: { buffer: statsBuffer } },
          { binding: 7, resource: { buffer: paramsBuffer } },
        ],
      });

      let querySet: GPUQuerySet | null = null;
      let queryResolveBuffer: GPUBuffer | null = null;
      let queryReadbackBuffer: GPUBuffer | null = null;
      if (timestampSupported) {
        querySet = device.createQuerySet({ type: "timestamp", count: 4 });
        queryResolveBuffer = createBuffer(device, "grid timestamps", 32, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC);
        queryReadbackBuffer = createBuffer(device, "grid timestamp readback", 32, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
      }
      const prepareUploadMs = performance.now() - prepareStarted;

      try {
        const encoder = device.createCommandEncoder({ label: "collision-lab uniform-grid" });
        encoder.clearBuffer(headsBuffer);
        encoder.clearBuffer(testedBuffer);
        encoder.clearBuffer(outputBuffer);
        encoder.clearBuffer(statsBuffer);

        const buildPass = encoder.beginComputePass(
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
        buildPass.setPipeline(buildPipeline);
        buildPass.setBindGroup(0, buildBindGroup);
        buildPass.dispatchWorkgroups(workgroups, 1, 1);
        buildPass.end();

        const testPass = encoder.beginComputePass(
          querySet
            ? {
                timestampWrites: {
                  querySet,
                  beginningOfPassWriteIndex: 2,
                  endOfPassWriteIndex: 3,
                },
              }
            : undefined,
        );
        testPass.setPipeline(testPipeline);
        testPass.setBindGroup(0, testBindGroup);
        testPass.dispatchWorkgroups(workgroups, 1, 1);
        testPass.end();

        encoder.copyBufferToBuffer(outputBuffer, 0, outputReadback, 0, bitsetBytes);
        encoder.copyBufferToBuffer(statsBuffer, 0, statsReadback, 0, 16);
        if (querySet && queryResolveBuffer && queryReadbackBuffer) {
          encoder.resolveQuerySet(querySet, 0, 4, queryResolveBuffer, 0);
          encoder.copyBufferToBuffer(queryResolveBuffer, 0, queryReadbackBuffer, 0, 32);
        }

        const submitStarted = performance.now();
        device.queue.submit([encoder.finish()]);
        const mappings: Promise<void>[] = [
          outputReadback.mapAsync(GPUMapMode.READ),
          statsReadback.mapAsync(GPUMapMode.READ),
        ];
        if (queryReadbackBuffer) {
          mappings.push(queryReadbackBuffer.mapAsync(GPUMapMode.READ));
        }
        await Promise.all(mappings);
        const submitReadbackMs = performance.now() - submitStarted;

        const bitset = new Uint32Array(outputReadback.getMappedRange().slice(0));
        const stats = new Uint32Array(statsReadback.getMappedRange().slice(0));
        const memberships = stats[0];
        const occupiedCells = stats[1];
        const aabbTests = stats[2];
        const overflow = stats[3];

        let buildPassMs: number | null = null;
        let testPassMs: number | null = null;
        let computeMs: number | null = null;
        if (queryReadbackBuffer) {
          const timestamps = new BigUint64Array(queryReadbackBuffer.getMappedRange().slice(0));
          buildPassMs = Number(timestamps[1] - timestamps[0]) / 1_000_000;
          testPassMs = Number(timestamps[3] - timestamps[2]) / 1_000_000;
          computeMs = buildPassMs + testPassMs;
        }

        const decodeStarted = performance.now();
        const overlaps = countSetBits(bitset);
        const decodeMs = performance.now() - decodeStarted;

        outputReadback.unmap();
        statsReadback.unmap();
        queryReadbackBuffer?.unmap();

        if (overflow !== 0) {
          throw new Error("The WebGPU uniform-grid pipeline exceeded a validated buffer or index bound.");
        }
        if (memberships !== layout.membershipCapacity) {
          throw new Error(
            `WebGPU grid membership mismatch: expected ${layout.membershipCapacity}, wrote ${memberships}.`,
          );
        }

        return {
          bitset,
          overlaps,
          aabbTests,
          occupiedCells,
          memberships,
          prepareUploadMs,
          computeMs,
          buildPassMs,
          testPassMs,
          submitReadbackMs,
          decodeMs,
          totalMs: performance.now() - totalStarted,
        };
      } finally {
        inputBuffer.destroy();
        rangesBuffer.destroy();
        headsBuffer.destroy();
        membershipsBuffer.destroy();
        testedBuffer.destroy();
        outputBuffer.destroy();
        statsBuffer.destroy();
        paramsBuffer.destroy();
        outputReadback.destroy();
        statsReadback.destroy();
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

async function assertShaderCompiles(module: GPUShaderModule, label: string) {
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter(
    (message: GPUCompilationMessage) => message.type === "error",
  );
  if (errors.length > 0) {
    throw new Error(
      `WebGPU ${label} shader compilation failed: ${errors.map((message: GPUCompilationMessage) => message.message).join(" | ")}`,
    );
  }
}

function validateInputs(
  aabbs: Float32Array<ArrayBuffer>,
  objectCount: number,
  cellSize: number,
) {
  if (!Number.isInteger(objectCount) || objectCount < 1 || objectCount > MAX_OBJECTS) {
    throw new Error(`The current GPU grid supports 1 to ${MAX_OBJECTS.toLocaleString()} objects.`);
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error("Grid cell size must be positive and finite.");
  }
  if (aabbs.length !== objectCount * 8) {
    throw new Error(`Expected ${objectCount * 8} packed AABB floats, received ${aabbs.length}.`);
  }
}

function buildGridLayout(
  aabbs: Float32Array<ArrayBuffer>,
  objectCount: number,
  cellSize: number,
): GridLayout {
  const ranges = new Int32Array(objectCount * 8);
  const origin: [number, number, number] = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const maximum: [number, number, number] = [Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];
  let membershipCapacity = 0;

  for (let body = 0; body < objectCount; body += 1) {
    const aabbOffset = body * 8;
    const rangeOffset = body * 8;
    const minX = cellCoordinate(aabbs[aabbOffset], cellSize);
    const minY = cellCoordinate(aabbs[aabbOffset + 1], cellSize);
    const minZ = cellCoordinate(aabbs[aabbOffset + 2], cellSize);
    const maxX = cellCoordinate(aabbs[aabbOffset + 4], cellSize);
    const maxY = cellCoordinate(aabbs[aabbOffset + 5], cellSize);
    const maxZ = cellCoordinate(aabbs[aabbOffset + 6], cellSize);

    ranges[rangeOffset] = minX;
    ranges[rangeOffset + 1] = minY;
    ranges[rangeOffset + 2] = minZ;
    ranges[rangeOffset + 3] = 0;
    ranges[rangeOffset + 4] = maxX;
    ranges[rangeOffset + 5] = maxY;
    ranges[rangeOffset + 6] = maxZ;
    ranges[rangeOffset + 7] = 0;

    origin[0] = Math.min(origin[0], minX);
    origin[1] = Math.min(origin[1], minY);
    origin[2] = Math.min(origin[2], minZ);
    maximum[0] = Math.max(maximum[0], maxX);
    maximum[1] = Math.max(maximum[1], maxY);
    maximum[2] = Math.max(maximum[2], maxZ);

    const memberships = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    membershipCapacity += memberships;
  }

  const dimensions: [number, number, number] = [
    maximum[0] - origin[0] + 1,
    maximum[1] - origin[1] + 1,
    maximum[2] - origin[2] + 1,
  ];
  const cellCount = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(cellCount) || cellCount < 1 || cellCount > 0xffff_ffff) {
    throw new Error("The dense GPU grid exceeds the current u32 cell-index range.");
  }
  if (
    !Number.isSafeInteger(membershipCapacity) ||
    membershipCapacity < 1 ||
    membershipCapacity > 0xffff_ffff
  ) {
    throw new Error("The GPU grid membership list exceeds the current u32 index range.");
  }

  return { ranges, origin, dimensions, cellCount, membershipCapacity };
}

function cellCoordinate(value: number, cellSize: number) {
  if (!Number.isFinite(value)) {
    throw new Error("AABB coordinates must be finite.");
  }
  const coordinate = Math.floor(value / cellSize);
  if (coordinate < -0x8000_0000 || coordinate > 0x7fff_ffff) {
    throw new Error("AABB coordinate exceeds the current i32 grid range.");
  }
  return coordinate;
}

function buildParamsBuffer(objectCount: number, wordCount: number, layout: GridLayout) {
  const buffer = new ArrayBuffer(48);
  const view = new DataView(buffer);
  view.setUint32(0, objectCount, true);
  view.setUint32(4, wordCount, true);
  view.setUint32(8, layout.cellCount, true);
  view.setUint32(12, layout.membershipCapacity, true);
  view.setInt32(16, layout.origin[0], true);
  view.setInt32(20, layout.origin[1], true);
  view.setInt32(24, layout.origin[2], true);
  view.setUint32(28, layout.dimensions[0], true);
  view.setUint32(32, layout.dimensions[1], true);
  view.setUint32(36, layout.dimensions[2], true);
  return buffer;
}

function createBuffer(device: GPUDevice, label: string, size: number, usage: GPUBufferUsageFlags) {
  return device.createBuffer({ label: `collision-lab ${label}`, size, usage });
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
