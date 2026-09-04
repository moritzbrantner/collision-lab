import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Scenarios",
  description:
    "Playable deterministic workloads that combine Collision Lab algorithms into small complete systems.",
};

export default function ScenariosPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
      <Link href="/" className="text-sm text-zinc-500 transition hover:text-zinc-200">
        ← Collision Lab
      </Link>

      <div className="mt-10 max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Playable scenarios
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-50 sm:text-6xl">
          Put the algorithms under a real workload.
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">
          These are deliberately small games and simulations, not a new game engine. Each scenario combines several collision questions into one deterministic workload and keeps the underlying algorithm choices inspectable.
        </p>
      </div>

      <section className="mt-12 grid gap-6 lg:grid-cols-2">
        <Link
          href="/scenarios/zombie-arena/"
          className="group overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/35 transition hover:border-zinc-600"
        >
          <div className="relative h-52 overflow-hidden border-b border-zinc-800 bg-zinc-950">
            <ArenaPreview />
          </div>
          <div className="p-6 sm:p-7">
            <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">
              <span>Top-down 2D</span>
              <span>·</span>
              <span>Broad phase + CCD</span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-zinc-100">Zombie Arena</h2>
            <p className="mt-3 leading-7 text-zinc-500">
              Move, shoot, build grid-snapped barricades, and survive deterministic zombie waves while switching the active broad-phase implementation and visualizing exact overlaps and projectile sweeps.
            </p>
            <span className="mt-5 inline-flex text-sm font-semibold text-zinc-200 transition group-hover:text-white">
              Play the scenario →
            </span>
          </div>
        </Link>

        <Link
          href="/scenarios/zombie-arena-3d/"
          className="group overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/35 transition hover:border-zinc-600"
        >
          <div className="relative h-52 overflow-hidden border-b border-zinc-800 bg-zinc-950">
            <Arena3dPreview />
          </div>
          <div className="p-6 sm:p-7">
            <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">
              <span>Third-person 3D</span>
              <span>·</span>
              <span>A* + vertical physics</span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-zinc-100">Zombie Arena 3D</h2>
            <p className="mt-3 leading-7 text-zinc-500">
              Jump through a real 3D obstacle field while zombies use deterministic A* paths, bullets use 3D continuous collision detection, and the collision broad phase remains swappable.
            </p>
            <span className="mt-5 inline-flex text-sm font-semibold text-zinc-200 transition group-hover:text-white">
              Play the 3D scenario →
            </span>
          </div>
        </Link>

        <div className="rounded-3xl border border-dashed border-zinc-800 p-7 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-600">
            Next slots
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-zinc-200">
            Small scenarios, different collision problems.
          </h2>
          <p className="mt-3 max-w-3xl leading-7 text-zinc-500">
            Future scenarios should exist only when they exercise a meaningfully different combination: vehicle movement, slopes, dense projectile fields, picking/raycasting, or mesh-heavy worlds.
          </p>
        </div>
      </section>
    </main>
  );
}

function ArenaPreview() {
  return (
    <svg
      viewBox="0 0 720 300"
      className="h-full w-full"
      role="img"
      aria-label="Stylized preview of the Zombie Arena"
    >
      <rect width="720" height="300" fill="#09090b" />
      <g stroke="#27272a" strokeWidth="1" opacity="0.8">
        {Array.from({ length: 13 }, (_, index) => (
          <line
            key={`v-${index}`}
            x1={60 + index * 50}
            x2={60 + index * 50}
            y1="0"
            y2="300"
          />
        ))}
        {Array.from({ length: 6 }, (_, index) => (
          <line
            key={`h-${index}`}
            x1="0"
            x2="720"
            y1={25 + index * 50}
            y2={25 + index * 50}
          />
        ))}
      </g>
      <g fill="#27272a" stroke="#52525b" strokeWidth="2">
        <rect x="86" y="45" width="16" height="115" />
        <rect x="515" y="135" width="16" height="115" />
        <rect x="275" y="48" width="125" height="16" />
      </g>
      <g fill="#92400e" stroke="#f59e0b" strokeWidth="2">
        <rect x="330" y="205" width="30" height="30" />
        <rect x="360" y="205" width="30" height="30" />
        <rect x="390" y="205" width="30" height="30" />
      </g>
      <circle cx="355" cy="135" r="13" fill="#0e7490" stroke="#67e8f9" strokeWidth="3" />
      <path d="M367 133 L405 120" stroke="#a5f3fc" strokeWidth="4" strokeLinecap="round" />
      <g fill="#3f6212" stroke="#84cc16" strokeWidth="2">
        <circle cx="182" cy="210" r="13" />
        <circle cx="220" cy="180" r="13" />
        <circle cx="555" cy="88" r="13" />
        <circle cx="590" cy="118" r="13" />
        <circle cx="465" cy="245" r="13" />
      </g>
      <path d="M405 120 L475 98" stroke="#fde68a" strokeWidth="2" strokeDasharray="7 5" />
      <circle cx="475" cy="98" r="4" fill="#fb7185" />
    </svg>
  );
}

function Arena3dPreview() {
  return (
    <svg
      viewBox="0 0 720 300"
      className="h-full w-full"
      role="img"
      aria-label="Stylized perspective preview of Zombie Arena 3D"
    >
      <rect width="720" height="300" fill="#09090b" />
      <path
        d="M40 256 L358 75 L690 250 L358 298 Z"
        fill="#18181b"
        stroke="#3f3f46"
        strokeWidth="2"
      />
      <g stroke="#27272a" strokeWidth="1" opacity="0.9">
        <path d="M118 256 L380 104" />
        <path d="M198 275 L420 124" />
        <path d="M285 292 L465 148" />
        <path d="M600 256 L336 104" />
        <path d="M520 277 L295 127" />
        <path d="M438 294 L252 151" />
      </g>
      <g fill="#3f3f46" stroke="#71717a" strokeWidth="2">
        <path d="M205 210 L250 184 L250 120 L205 146 Z" />
        <path d="M250 184 L300 210 L300 146 L250 120 Z" />
        <path d="M452 226 L494 201 L494 135 L452 161 Z" />
        <path d="M494 201 L540 225 L540 160 L494 135 Z" />
      </g>
      <g
        fill="none"
        stroke="#22d3ee"
        strokeWidth="3"
        strokeDasharray="8 6"
        opacity="0.85"
      >
        <path d="M150 235 L235 250 L330 215 L393 185" />
        <path d="M590 228 L525 250 L438 238 L393 185" />
      </g>
      <g fill="#4d7c0f" stroke="#84cc16" strokeWidth="2">
        <circle cx="150" cy="230" r="13" />
        <circle cx="590" cy="222" r="13" />
        <circle cx="535" cy="165" r="12" />
      </g>
      <g>
        <circle cx="393" cy="176" r="15" fill="#0e7490" stroke="#67e8f9" strokeWidth="3" />
        <path d="M403 173 L448 154" stroke="#a5f3fc" strokeWidth="5" strokeLinecap="round" />
        <path d="M448 154 L522 122" stroke="#fde68a" strokeWidth="2" strokeDasharray="8 6" />
      </g>
    </svg>
  );
}
