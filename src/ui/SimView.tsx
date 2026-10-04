import { useEffect, useRef, useState } from "react";
import type { LevelDef, Snapshot } from "../engine/types";
import { drawBuilding } from "./render";
import { PersonAnimator } from "./animator";

interface SimViewProps {
  snapshotRef: React.MutableRefObject<Snapshot | null>;
  level: LevelDef;
  /** How many sim-seconds of animation should elapse per real second (0 = paused). */
  animSpeed: number;
}

/**
 * Canvas view of the building. Reads the latest snapshot from a ref inside a
 * requestAnimationFrame loop, so worker updates at 15Hz never re-render React.
 * The PersonAnimator turns per-snapshot positions into smooth motion.
 */
export function SimView({ snapshotRef, level, animSpeed }: SimViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animatorRef = useRef(new PersonAnimator());

  // A different level means different passenger ids — start fresh.
  useEffect(() => {
    animatorRef.current.clear();
  }, [level]);

  useEffect(() => {
    let raf = 0;
    let lastT = performance.now();
    const draw = () => {
      const now = performance.now();
      // Real frame time, scaled so animations advance in simulated time.
      const dt = Math.min(0.1, Math.max(0.001, (now - lastT) / 1000)) * animSpeed;
      lastT = now;
      const canvas = canvasRef.current;
      if (canvas) {
        // Size the backing store to the CSS size * devicePixelRatio.
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(canvas.clientWidth * dpr);
        const h = Math.round(canvas.clientHeight * dpr);
        if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext("2d");
        if (ctx && canvas.width > 0) {
          ctx.save();
          drawBuilding(
            ctx,
            snapshotRef.current,
            level,
            canvas.width,
            canvas.height,
            animatorRef.current,
            dt
          );
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [level, snapshotRef, animSpeed]);

  return <canvas ref={canvasRef} className="sim-canvas" />;
}

/** Small live stats readout; polls the snapshot ref a few times per second. */
export function MetricsBar({ snapshotRef, timeLimit }: { snapshotRef: React.MutableRefObject<Snapshot | null>; timeLimit: number }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  const snap = snapshotRef.current;
  const time = snap?.time ?? 0;
  const remaining = Math.max(0, timeLimit - time);

  return (
    <div className="metrics-bar">
      <Metric label="time" value={`${time.toFixed(1)}s`} />
      <Metric label="remaining" value={`${remaining.toFixed(0)}s`} warn={remaining < 15} />
      <Metric label="delivered" value={`${snap?.delivered ?? 0}`} />
      <Metric label="waiting" value={`${snap?.totalWaiting ?? 0}`} warn={(snap?.totalWaiting ?? 0) > 15} />
      <Metric label="avg wait" value={`${(snap?.avgWait ?? 0).toFixed(1)}s`} />
      <Metric label="max wait" value={`${(snap?.maxWait ?? 0).toFixed(1)}s`} />
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`metric ${warn ? "metric-warn" : ""}`}>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}
