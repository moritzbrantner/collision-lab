export type MatrixLayer = {
  name: string;
  bits: number;
  allowsBits: number;
};

export type MatrixEntry = {
  left: number;
  right: number;
  allowed: boolean;
};

export type InteractionMatrixData = {
  layers: MatrixLayer[];
  entries: MatrixEntry[];
};

type Props = {
  matrix: InteractionMatrixData | null;
  spatialOverlaps: number | null;
  filteredOut: number | null;
  interactionPairs: number | null;
  sensorPairs: number | null;
  onToggle: (leftBits: number, rightBits: number, allowed: boolean) => void;
};

export function InteractionMatrixEditor({
  matrix,
  spatialOverlaps,
  filteredOut,
  interactionPairs,
  sensorPairs,
  onToggle,
}: Props) {
  if (!matrix) return null;

  const entryMap = new Map(
    matrix.entries.map((entry) => [`${entry.left}:${entry.right}`, entry.allowed] as const),
  );

  return (
    <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900/35 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Interaction matrix
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            World policy after spatial overlap. Click a cell to toggle the pair symmetrically.
          </p>
        </div>
      </div>

      <div
        className="mt-4 grid gap-1.5 text-center text-[11px]"
        style={{ gridTemplateColumns: `5.5rem repeat(${matrix.layers.length}, minmax(3rem, 1fr))` }}
      >
        <div />
        {matrix.layers.map((layer) => (
          <div key={`header-${layer.bits}`} className="truncate px-1 py-1 font-semibold capitalize text-zinc-400">
            {layer.name}
          </div>
        ))}

        {matrix.layers.map((left) => (
          <MatrixRow
            key={left.bits}
            left={left}
            layers={matrix.layers}
            entryMap={entryMap}
            onToggle={onToggle}
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MatrixMetric label="Spatial" value={spatialOverlaps} />
        <MatrixMetric label="Filtered" value={filteredOut} />
        <MatrixMetric label="Accepted" value={interactionPairs} />
        <MatrixMetric label="Sensor" value={sensorPairs} />
      </div>
    </div>
  );
}

function MatrixRow({
  left,
  layers,
  entryMap,
  onToggle,
}: {
  left: MatrixLayer;
  layers: MatrixLayer[];
  entryMap: Map<string, boolean>;
  onToggle: Props["onToggle"];
}) {
  return (
    <>
      <div className="truncate px-1 py-2 text-left font-semibold capitalize text-zinc-400">
        {left.name}
      </div>
      {layers.map((right) => {
        const allowed = entryMap.get(`${left.bits}:${right.bits}`) ?? false;
        return (
          <button
            key={`${left.bits}:${right.bits}`}
            type="button"
            aria-label={`${left.name} and ${right.name}: ${allowed ? "enabled" : "disabled"}`}
            aria-pressed={allowed}
            onClick={() => onToggle(left.bits, right.bits, !allowed)}
            className={`rounded-lg border px-2 py-2 font-mono font-semibold transition ${
              allowed
                ? "border-emerald-700/70 bg-emerald-950/40 text-emerald-300 hover:border-emerald-500"
                : "border-zinc-800 bg-zinc-950 text-zinc-600 hover:border-zinc-600 hover:text-zinc-400"
            }`}
          >
            {allowed ? "ON" : "OFF"}
          </button>
        );
      })}
    </>
  );
}

function MatrixMetric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="mt-1 font-mono text-xs text-zinc-300">
        {value === null ? "—" : value.toLocaleString()}
      </div>
    </div>
  );
}
