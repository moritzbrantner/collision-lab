"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  ZOMBIE_ARENA_3D_LABEL,
  ZOMBIE_ARENA_3D_SNAPSHOT_EVENT,
} from "../lib/zombie-arena-3d-runtime";

type Vec3 = [number, number, number];
type ArenaDiagnosticsSnapshot = {
  frame: number;
  algorithm: string;
  fixedDt: number;
  player: {
    position: Vec3;
    velocity: Vec3;
    health: number;
    maxHealth: number;
    grounded: boolean;
  };
  debug: {
    overlapPairs: [number, number][];
    navigation: {
      blocked: [number, number][];
      paths: unknown[];
    };
  };
  stats: {
    zombies: number;
    walls: number;
    bullets: number;
    kills: number;
    shots: number;
    possiblePairs: number;
    aabbTests: number;
    occupiedCells: number;
    overlaps: number;
    ccdTests: number;
    ccdHits: number;
    pathReplans: number;
    pathFound: number;
    pathExpanded: number;
    pathReplansTotal: number;
    pathExpandedTotal: number;
  };
};

type RuntimeSample = {
  fps: number;
  averageFrameMs: number;
  p95FrameMs: number;
  worstFrameMs: number;
  stutters: number;
  simulationHz: number;
  viewport: string;
  devicePixelRatio: number;
  pointerLocked: boolean;
  fullscreen: boolean;
};

const SAMPLE_WINDOW_MS = 500;
const STUTTER_THRESHOLD_MS = 25;
const EMPTY_SAMPLE: RuntimeSample = {
  fps: 0,
  averageFrameMs: 0,
  p95FrameMs: 0,
  worstFrameMs: 0,
  stutters: 0,
  simulationHz: 0,
  viewport: "—",
  devicePixelRatio: 1,
  pointerLocked: false,
  fullscreen: false,
};

export function ZombieArena3dDiagnostics() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(true);
  const [snapshot, setSnapshot] = useState<ArenaDiagnosticsSnapshot | null>(null);
  const [sample, setSample] = useState<RuntimeSample>(EMPTY_SAMPLE);
  const latestSnapshotRef = useRef<ArenaDiagnosticsSnapshot | null>(null);

  useEffect(() => {
    const findTarget = () => {
      const next = document.querySelector<HTMLElement>(
        `[role="application"][aria-label="${ZOMBIE_ARENA_3D_LABEL}"]`,
      );
      if (!next) return false;
      setTarget(next);
      return true;
    };

    if (findTarget()) return;

    const observer = new MutationObserver(() => {
      if (findTarget()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onSnapshot = (event: Event) => {
      const raw = (event as CustomEvent<string>).detail;
      try {
        latestSnapshotRef.current = JSON.parse(raw) as ArenaDiagnosticsSnapshot;
      } catch {
        latestSnapshotRef.current = null;
      }
    };

    window.addEventListener(ZOMBIE_ARENA_3D_SNAPSHOT_EVENT, onSnapshot);
    return () => window.removeEventListener(ZOMBIE_ARENA_3D_SNAPSHOT_EVENT, onSnapshot);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F3" || event.repeat) return;
      event.preventDefault();
      setVisible((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!target) return;

    let animationFrame = 0;
    let previousFrameAt = performance.now();
    let sampleStartedAt = previousFrameAt;
    let simulationFrameAtStart = latestSnapshotRef.current?.frame ?? 0;
    let frameDeltas: number[] = [];

    const collect = (now: number) => {
      const frameDelta = now - previousFrameAt;
      previousFrameAt = now;
      if (frameDelta > 0 && frameDelta < 250) frameDeltas.push(frameDelta);

      const elapsed = now - sampleStartedAt;
      if (elapsed >= SAMPLE_WINDOW_MS) {
        const latest = latestSnapshotRef.current;
        const simulationFrame = latest?.frame ?? simulationFrameAtStart;
        const sorted = [...frameDeltas].sort((left, right) => left - right);
        const totalFrameMs = frameDeltas.reduce((total, value) => total + value, 0);
        const averageFrameMs = frameDeltas.length > 0 ? totalFrameMs / frameDeltas.length : 0;
        const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);

        setSnapshot(latest);
        setSample({
          fps: elapsed > 0 ? (frameDeltas.length * 1000) / elapsed : 0,
          averageFrameMs,
          p95FrameMs: sorted[p95Index] ?? 0,
          worstFrameMs: sorted.at(-1) ?? 0,
          stutters: frameDeltas.filter((value) => value > STUTTER_THRESHOLD_MS).length,
          simulationHz: elapsed > 0 ? ((simulationFrame - simulationFrameAtStart) * 1000) / elapsed : 0,
          viewport: `${Math.round(target.clientWidth)}×${Math.round(target.clientHeight)}`,
          devicePixelRatio: window.devicePixelRatio,
          pointerLocked: document.pointerLockElement === target,
          fullscreen: document.fullscreenElement === target,
        });

        simulationFrameAtStart = simulationFrame;
        sampleStartedAt = now;
        frameDeltas = [];
      }

      animationFrame = requestAnimationFrame(collect);
    };

    animationFrame = requestAnimationFrame(collect);
    return () => cancelAnimationFrame(animationFrame);
  }, [target]);

  if (!target || !visible) return null;

  return createPortal(
    <DiagnosticsPanel snapshot={snapshot} sample={sample} />,
    target,
  );
}

function DiagnosticsPanel({
  snapshot,
  sample,
}: {
  snapshot: ArenaDiagnosticsSnapshot | null;
  sample: RuntimeSample;
}) {
  const broadPhaseAvoided = snapshot && snapshot.stats.possiblePairs > 0
    ? Math.max(0, 100 * (1 - snapshot.stats.aabbTests / snapshot.stats.possiblePairs))
    : 0;
  const speed = snapshot ? Math.hypot(...snapshot.player.velocity) : 0;

  return (
    <aside
      aria-label="Performance and collision diagnostics"
      className="pointer-events-none absolute right-3 top-3 z-20 w-[min(24rem,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-950/90 text-[11px] text-zinc-400 shadow-2xl backdrop-blur-md"
    >
      <div className="border-b border-zinc-800 px-3 py-2.5">
        <div className="flex items-center justify-between gap-4">
          <p className="font-semibold uppercase tracking-[0.14em] text-zinc-200">
            Performance & collision diagnostics
          </p>
          <span className="font-mono text-[10px] text-zinc-600">F3 hide</span>
        </div>
        <p className="mt-1 text-[10px] text-zinc-600">
          Browser timing is observational; simulation and collision counters come from Rust/WASM.
        </p>
      </div>

      <DiagnosticSection title="Frame loop">
        <DiagnosticRow label="render FPS" value={format(sample.fps, 1)} />
        <DiagnosticRow label="avg / p95 frame" value={`${format(sample.averageFrameMs, 2)} / ${format(sample.p95FrameMs, 2)} ms`} />
        <DiagnosticRow label="worst frame" value={`${format(sample.worstFrameMs, 2)} ms`} />
        <DiagnosticRow label=">25 ms frames / sample" value={sample.stutters} />
        <DiagnosticRow label="simulation rate" value={`${format(sample.simulationHz, 1)} Hz`} />
        <DiagnosticRow label="fixed simulation dt" value={snapshot ? `${format(snapshot.fixedDt * 1000, 2)} ms` : "—"} />
        <DiagnosticRow label="render surface" value={`${sample.viewport} @ ${format(sample.devicePixelRatio, 2)}× DPR`} />
      </DiagnosticSection>

      <DiagnosticSection title="Collision">
        <DiagnosticRow label="broad phase" value={snapshot?.algorithm ?? "—"} />
        <DiagnosticRow label="candidate pairs" value={snapshot?.stats.possiblePairs ?? "—"} />
        <DiagnosticRow label="AABB tests" value={snapshot?.stats.aabbTests ?? "—"} />
        <DiagnosticRow label="broad-phase avoided" value={snapshot ? `${format(broadPhaseAvoided, 1)}%` : "—"} />
        <DiagnosticRow label="overlaps / pair list" value={snapshot ? `${snapshot.stats.overlaps} / ${snapshot.debug.overlapPairs.length}` : "—"} />
        <DiagnosticRow label="CCD tests / hits" value={snapshot ? `${snapshot.stats.ccdTests} / ${snapshot.stats.ccdHits}` : "—"} />
        <DiagnosticRow label="occupied broad-phase cells" value={snapshot?.stats.occupiedCells ?? "—"} />
      </DiagnosticSection>

      <DiagnosticSection title="Navigation & world">
        <DiagnosticRow label="A* replans / frame" value={snapshot?.stats.pathReplans ?? "—"} />
        <DiagnosticRow label="A* expanded / frame" value={snapshot?.stats.pathExpanded ?? "—"} />
        <DiagnosticRow label="A* replans / expanded total" value={snapshot ? `${snapshot.stats.pathReplansTotal} / ${snapshot.stats.pathExpandedTotal}` : "—"} />
        <DiagnosticRow label="paths / blocked nav cells" value={snapshot ? `${snapshot.debug.navigation.paths.length} / ${snapshot.debug.navigation.blocked.length}` : "—"} />
        <DiagnosticRow label="zombies / walls / bullets" value={snapshot ? `${snapshot.stats.zombies} / ${snapshot.stats.walls} / ${snapshot.stats.bullets}` : "—"} />
        <DiagnosticRow label="kills / shots" value={snapshot ? `${snapshot.stats.kills} / ${snapshot.stats.shots}` : "—"} />
      </DiagnosticSection>

      <DiagnosticSection title="Player & capture" last>
        <DiagnosticRow label="position" value={snapshot ? vector(snapshot.player.position) : "—"} />
        <DiagnosticRow label="velocity" value={snapshot ? `${vector(snapshot.player.velocity)} · ${format(speed, 2)} m/s` : "—"} />
        <DiagnosticRow label="grounded" value={snapshot ? (snapshot.player.grounded ? "yes" : "no") : "—"} />
        <DiagnosticRow label="health" value={snapshot ? `${Math.ceil(snapshot.player.health)} / ${snapshot.player.maxHealth}` : "—"} />
        <DiagnosticRow label="simulation frame" value={snapshot?.frame ?? "—"} />
        <DiagnosticRow label="pointer / fullscreen" value={`${sample.pointerLocked ? "locked" : "free"} / ${sample.fullscreen ? "yes" : "no"}`} />
      </DiagnosticSection>
    </aside>
  );
}

function DiagnosticSection({
  title,
  last = false,
  children,
}: {
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={last ? "px-3 py-2.5" : "border-b border-zinc-800 px-3 py-2.5"}>
      <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
        {title}
      </p>
      <dl>{children}</dl>
    </section>
  );
}

function DiagnosticRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-0.5">
      <dt className="truncate text-zinc-500">{label}</dt>
      <dd className="max-w-56 text-right font-mono text-zinc-300">{value}</dd>
    </div>
  );
}

function vector(value: Vec3) {
  return value.map((component) => format(component, 2)).join(", ");
}

function format(value: number, digits: number) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}
