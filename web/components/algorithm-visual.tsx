type Props = {
  slug: string;
};

export function AlgorithmVisual({ slug }: Props) {
  if (slug === "uniform-grid") {
    return (
      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <svg viewBox="0 0 640 360" role="img" aria-label="Uniform grid spatial partition diagram" className="w-full">
          <rect x="0" y="0" width="640" height="360" rx="18" fill="#09090b" />
          {[80, 160, 240, 320, 400, 480, 560].map((x) => (
            <line key={`x-${x}`} x1={x} y1="20" x2={x} y2="340" stroke="#27272a" />
          ))}
          {[80, 160, 240, 320].map((y) => (
            <line key={`y-${y}`} x1="20" y1={y} x2="620" y2={y} stroke="#27272a" />
          ))}
          <rect x="105" y="102" width="118" height="74" rx="12" fill="#3f3f46" stroke="#d4d4d8" strokeWidth="2" />
          <rect x="188" y="138" width="106" height="84" rx="12" fill="#52525b" stroke="#fafafa" strokeWidth="2" />
          <rect x="438" y="232" width="92" height="62" rx="12" fill="#27272a" stroke="#a1a1aa" strokeWidth="2" />
          <circle cx="160" cy="139" r="5" fill="#fafafa" />
          <circle cx="241" cy="180" r="5" fill="#fafafa" />
          <text x="32" y="40" fill="#a1a1aa" fontSize="15">Only shared cells create candidates</text>
        </svg>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
      <svg viewBox="0 0 640 360" role="img" aria-label="Naive all-pairs comparison diagram" className="w-full">
        <rect x="0" y="0" width="640" height="360" rx="18" fill="#09090b" />
        {[
          [105, 88], [250, 68], [410, 98], [520, 220], [335, 280], [145, 245],
        ].flatMap(([x1, y1], index, points) =>
          points.slice(index + 1).map(([x2, y2], offset) => (
            <line key={`${index}-${offset}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3f3f46" strokeWidth="1.5" />
          )),
        )}
        {[[105, 88], [250, 68], [410, 98], [520, 220], [335, 280], [145, 245]].map(([cx, cy], index) => (
          <g key={index}>
            <circle cx={cx} cy={cy} r="22" fill="#18181b" stroke="#d4d4d8" strokeWidth="2" />
            <text x={cx} y={cy + 5} textAnchor="middle" fill="#fafafa" fontSize="14">{index + 1}</text>
          </g>
        ))}
        <text x="32" y="332" fill="#a1a1aa" fontSize="15">Every unique pair is tested exactly once</text>
      </svg>
    </div>
  );
}
