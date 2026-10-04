import { useCallback, useEffect, useRef, useState } from "react";
import type { RunResult, Snapshot } from "../engine/types";
import type { FromWorkerMessage } from "../worker/messages";

export type SimStatus = "idle" | "running" | "finished" | "error";

/** If the worker goes this long without any message while running, assume an infinite loop. */
const WATCHDOG_TIMEOUT_MS = 4000;
const WATCHDOG_INTERVAL_MS = 1000;

export interface SimulationController {
  status: SimStatus;
  result: RunResult | null;
  error: string | null;
  paused: boolean;
  speed: number;
  /** Latest snapshot; mutated in place, read by the canvas render loop. */
  snapshotRef: React.MutableRefObject<Snapshot | null>;
  start: (code: string, levelId: number, seed?: number) => void;
  stop: () => void;
  setSpeed: (speed: number) => void;
  setPaused: (paused: boolean) => void;
}

export function useSimulation(): SimulationController {
  const [status, setStatus] = useState<SimStatus>("idle");
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPausedState] = useState(false);
  const [speed, setSpeedState] = useState(1);

  const snapshotRef = useRef<Snapshot | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const lastMessageAtRef = useRef(0);
  const pausedRef = useRef(false);
  const statusRef = useRef<SimStatus>("idle");
  statusRef.current = status;
  pausedRef.current = paused;

  const terminateWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    terminateWorker();
    snapshotRef.current = null; // don't render a stale building after stopping
    setResult(null); // banners belong to the level they finished on
    setError(null);
    setStatus("idle");
    setPausedState(false);
  }, [terminateWorker, snapshotRef]);

  const start = useCallback(
    (code: string, levelId: number, seed = 1) => {
      terminateWorker();
      snapshotRef.current = null;
      setResult(null);
      setError(null);
      setPausedState(false);
      setStatus("running");

      const worker = new Worker(
        new URL("../worker/sim.worker.ts", import.meta.url),
        { type: "module" }
      );
      workerRef.current = worker;
      lastMessageAtRef.current = Date.now();

      worker.onmessage = (e: MessageEvent<FromWorkerMessage>) => {
        lastMessageAtRef.current = Date.now();
        const msg = e.data;
        switch (msg.type) {
          case "ready":
            break;
          case "snapshot":
            snapshotRef.current = msg.snapshot;
            break;
          case "finished":
            setResult(msg.result);
            setStatus(msg.result.error ? "error" : "finished");
            if (msg.result.error) setError(msg.result.error);
            terminateWorker();
            break;
          case "error":
            setError(msg.message);
            setStatus("error");
            terminateWorker();
            break;
        }
      };

      worker.onerror = (e) => {
        setError(e.message || "Worker error");
        setStatus("error");
        terminateWorker();
      };

      worker.postMessage({ type: "start", code, levelId, seed, speed });
    },
    [terminateWorker, speed]
  );

  const setSpeed = useCallback((s: number) => {
    setSpeedState(s);
    workerRef.current?.postMessage({ type: "setSpeed", speed: s });
  }, []);

  const setPaused = useCallback((p: boolean) => {
    setPausedState(p);
    workerRef.current?.postMessage({ type: "setPaused", paused: p });
  }, []);

  // Watchdog: a worker that stops messaging while running is stuck
  // (almost certainly an infinite loop in player code). Kill it.
  useEffect(() => {
    const id = setInterval(() => {
      if (
        statusRef.current === "running" &&
        !pausedRef.current &&
        Date.now() - lastMessageAtRef.current > WATCHDOG_TIMEOUT_MS
      ) {
        terminateWorker();
        setError(
          "Your code stopped responding — it probably has an infinite loop. The simulation was stopped."
        );
        setStatus("error");
      }
    }, WATCHDOG_INTERVAL_MS);
    return () => clearInterval(id);
  }, [terminateWorker]);

  // Clean up on unmount.
  useEffect(() => terminateWorker, [terminateWorker]);

  return {
    status,
    result,
    error,
    paused,
    speed,
    snapshotRef,
    start,
    stop,
    setSpeed,
    setPaused,
  };
}
