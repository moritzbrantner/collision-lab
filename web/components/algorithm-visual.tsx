type Props = {
  slug: string;
};

const points = [[105, 88], [250, 68], [410, 98], [520, 220], [335, 280], [145, 245]];

export function AlgorithmVisual({ slug }: Props) {
  if (slug === "uniform-grid") {
    return (
      <Frame label="Uniform grid spatial partition diagram">
        {[80, 160, 240, 320, 400, 480, 560].map((x) => <line key={`x-${x}`} x1={x} y1="20" x2={x} y2="340" stroke="#27272a" />)}
        {[80, 160, 240, 320].map((y) => <line key={`y-${y}`} x1="20" y1={y} x2="620" y2={y} stroke="#27272a" />)}
        <rect x="105" y="102" width="118" height="74" rx="12" fill="#3f3f46" stroke="#d4d4d8" strokeWidth="2" />
        <rect x="188" y="138" width="106" height="84" rx="12" fill="#52525b" stroke="#fafafa" strokeWidth="2" />
        <rect x="438" y="232" width="92" height="62" rx="12" fill="#27272a" stroke="#a1a1aa" strokeWidth="2" />
        <text x="32" y="40" fill="#a1a1aa" fontSize="15">Only shared cells create candidates</text>
      </Frame>
    );
  }

  if (slug === "octree") {
    return (
      <Frame label="Octree hierarchical subdivision diagram">
        <rect x="90" y="72" width="460" height="232" fill="none" stroke="#d4d4d8" strokeWidth="2" />
        <line x1="320" y1="72" x2="320" y2="304" stroke="#22d3ee" strokeWidth="2" />
        <line x1="90" y1="188" x2="550" y2="188" stroke="#22d3ee" strokeWidth="2" />
        <line x1="205" y1="72" x2="205" y2="304" stroke="#3f3f46" strokeWidth="1" strokeDasharray="6 6" />
        <line x1="435" y1="72" x2="435" y2="304" stroke="#3f3f46" strokeWidth="1" strokeDasharray="6 6" />
        <line x1="90" y1="130" x2="550" y2="130" stroke="#3f3f46" strokeWidth="1" strokeDasharray="6 6" />
        <line x1="90" y1="246" x2="550" y2="246" stroke="#3f3f46" strokeWidth="1" strokeDasharray="6 6" />
        <rect x="120" y="96" width="68" height="50" rx="9" fill="#27272a" stroke="#fafafa" strokeWidth="2" />
        <rect x="250" y="150" width="92" height="70" rx="9" fill="#3f3f46" stroke="#d4d4d8" strokeWidth="2" />
        <rect x="410" y="225" width="70" height="48" rx="9" fill="#27272a" stroke="#a1a1aa" strokeWidth="2" />
        <text x="32" y="40" fill="#a1a1aa" fontSize="15">Crowded regions subdivide into eight smaller cubes</text>
        <text x="462" y="94" fill="#22d3ee" fontSize="12">depth 1</text>
      </Frame>
    );
  }

  if (slug === "sweep-and-prune") {
    return (
      <Frame label="Sweep and prune interval diagram">
        <line x1="52" y1="290" x2="590" y2="290" stroke="#71717a" strokeWidth="2" />
        {[
          [90, 250, 90], [155, 330, 135], [350, 455, 180], [430, 560, 225],
        ].map(([start, end, y], index) => (
          <g key={index}>
            <line x1={start} y1={y} x2={end} y2={y} stroke="#d4d4d8" strokeWidth="14" strokeLinecap="round" />
            <line x1={start} y1={y - 16} x2={start} y2={y + 16} stroke="#fafafa" />
            <line x1={end} y1={y - 16} x2={end} y2={y + 16} stroke="#fafafa" />
          </g>
        ))}
        <line x1="305" y1="48" x2="305" y2="306" stroke="#60a5fa" strokeWidth="3" strokeDasharray="8 8" />
        <text x="32" y="40" fill="#a1a1aa" fontSize="15">Sweep past sorted interval endpoints</text>
      </Frame>
    );
  }

  if (slug === "static-bvh" || slug === "dynamic-aabb-tree") {
    const dynamic = slug === "dynamic-aabb-tree";
    return (
      <Frame label={dynamic ? "Dynamic AABB tree diagram" : "Static BVH diagram"}>
        <rect x="65" y="62" width="510" height="238" rx="18" fill="none" stroke="#52525b" strokeWidth="2" />
        <rect x="84" y="86" width="220" height="182" rx="16" fill="none" stroke="#71717a" strokeWidth="2" />
        <rect x="330" y="102" width="218" height="166" rx="16" fill="none" stroke="#71717a" strokeWidth="2" />
        <rect x="118" y="126" width="92" height="72" rx="10" fill="#27272a" stroke="#d4d4d8" strokeWidth="2" />
        <rect x="192" y="170" width="84" height="66" rx="10" fill="#3f3f46" stroke="#fafafa" strokeWidth="2" />
        <rect x="368" y="142" width="76" height="66" rx="10" fill="#27272a" stroke="#d4d4d8" strokeWidth="2" />
        <rect x="446" y="182" width="70" height="56" rx="10" fill="#27272a" stroke="#a1a1aa" strokeWidth="2" />
        {dynamic && <rect x="103" y="111" width="188" height="142" rx="16" fill="none" stroke="#a78bfa" strokeWidth="2" strokeDasharray="7 7" />}
        <text x="32" y="40" fill="#a1a1aa" fontSize="15">{dynamic ? "Fat leaves absorb small movements" : "Parent bounds reject whole subtrees"}</text>
      </Frame>
    );
  }

  return (
    <Frame label="Naive all-pairs comparison diagram">
      {points.flatMap(([x1, y1], index) => points.slice(index + 1).map(([x2, y2], offset) => (
        <line key={`${index}-${offset}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3f3f46" strokeWidth="1.5" />
      )))}
      {points.map(([cx, cy], index) => (
        <g key={index}>
          <circle cx={cx} cy={cy} r="22" fill="#18181b" stroke="#d4d4d8" strokeWidth="2" />
          <text x={cx} y={cy + 5} textAnchor="middle" fill="#fafafa" fontSize="14">{index + 1}</text>
        </g>
      ))}
      <text x="32" y="332" fill="#a1a1aa" fontSize="15">Every unique pair is tested exactly once</text>
    </Frame>
  );
}

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
      <svg viewBox="0 0 640 360" role="img" aria-label={label} className="w-full">
        <rect x="0" y="0" width="640" height="360" rx="18" fill="#09090b" />
        {children}
      </svg>
    </div>
  );
}
