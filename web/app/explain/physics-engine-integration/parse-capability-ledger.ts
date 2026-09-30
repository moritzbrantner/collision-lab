function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Invalid engine capability object");
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Invalid engine capability text");
  }
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Invalid engine capability list");
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid engine capability count");
  }
  return value;
}

function shape(value: unknown) {
  if (
    value === "sphere" ||
    value === "box" ||
    value === "capsule" ||
    value === "wedge"
  ) {
    return value;
  }
  throw new Error("Unknown engine shape");
}

/** Parse engine-owned metadata, without inferring capability truth from scene dispatches. */
export function parseCapabilityLedger(json: string) {
  const raw: unknown = JSON.parse(json);
  const data = record(raw);
  if (
    data.schemaVersion !== 1 ||
    data.world !== "approximate::World" ||
    data.scalar !== "f64"
  ) {
    throw new Error("Unsupported engine capability schema");
  }
  const capabilities = Object.entries(record(data.capabilities)).map(
    ([key, value]) => ({
      key,
      status: text(value),
    }),
  );
  const required = [
    "bounds",
    "sweptBounds",
    "support",
    "distance",
    "contacts",
    "manifolds",
    "mass",
    "centerOfMass",
    "inertia",
    "overlaps",
    "rays",
    "shapeCasts",
    "shapeCastFeatures",
    "translationCcd",
    "rotationCcd",
    "chronologicalImpactResponse",
  ];
  if (
    required.some((key) => !capabilities.some((entry) => entry.key === key))
  ) {
    throw new Error("Incomplete engine capabilities");
  }
  const validation = Object.entries(record(data.validation)).map(
    ([key, value]) => {
      if (
        typeof value !== "boolean" &&
        (typeof value !== "number" || !Number.isFinite(value))
      ) {
        throw new Error("Invalid engine validation rule");
      }
      return { key, value };
    },
  );
  const requiredValidation = [
    "finiteValuesRequired",
    "positiveDimensionMinimum",
    "dimensionMaximumExclusive",
    "capsuleHalfSegmentMinimum",
    "fixedMass",
    "positiveMassMinimum",
    "massMaximumExclusive",
  ];
  if (
    requiredValidation.some(
      (key) => !validation.some((entry) => entry.key === key),
    )
  ) {
    throw new Error("Incomplete engine validation rules");
  }
  const workCounters = array(data.workCounters).map(text);
  const shapes = array(data.shapes).map((value) => {
    const item = record(value);
    if (typeof item.collapsedSkeleton !== "boolean")
      throw new Error("Invalid collapsed skeleton flag");
    return {
      kind: shape(item.kind),
      solverCom: text(item.solverCom),
      solverDynamicRotation: text(item.solverDynamicRotation),
      collapsedSkeleton: item.collapsedSkeleton,
    };
  });
  if (
    shapes.length !== 4 ||
    new Set(shapes.map((item) => item.kind)).size !== 4
  ) {
    throw new Error("Incomplete engine shape matrix");
  }
  const pairs = array(data.pairs).map((value, index) => {
    const item = record(value);
    if (
      integer(item.dispatchIndex) !== index ||
      integer(item.manifoldPointLimit) === 0
    ) {
      throw new Error("Invalid engine dispatch cell");
    }
    return {
      left: shape(item.left),
      right: shape(item.right),
      classification: text(item.classification),
      manifoldPointLimit: integer(item.manifoldPointLimit),
      translationSearch: text(item.translationSearch),
      shapeCastSearch: text(item.shapeCastSearch),
      genericFallback: text(item.genericFallback),
      referenceAcceptance: text(item.referenceAcceptance),
    };
  });
  const keys = new Set(
    pairs.map((pair) => [pair.left, pair.right].sort().join(":")),
  );
  if (pairs.length !== 10 || keys.size !== 10)
    throw new Error("Incomplete engine pair matrix");
  return {
    world: data.world,
    scalar: data.scalar,
    worldApiStatus: text(data.worldApiStatus),
    referenceAcceptance: text(data.referenceAcceptance),
    capabilities,
    validation,
    workCounters,
    shapes,
    pairs,
  };
}

/** Only actual report counters are presented as measured work. */
export function parseSegmentWork(json: string) {
  const raw: unknown = JSON.parse(json);
  const data = record(raw);
  if (data.source !== "physics-engine")
    throw new Error("Invalid engine report source");
  const pairs = array(data.pairs).map((value) => {
    const item = record(value);
    return {
      left: shape(item.left),
      right: shape(item.right),
      distances: integer(item.primitiveSegmentDistanceEvaluations),
      features: integer(item.primitiveSegmentFeatureTests),
    };
  });
  const keys = new Set(
    pairs.map((pair) => [pair.left, pair.right].sort().join(":")),
  );
  if (pairs.length !== 10 || keys.size !== 10)
    throw new Error("Incomplete engine work matrix");
  return pairs;
}
