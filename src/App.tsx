import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_STARTER_CODE, LEVELS } from "./engine/levels";
import { goalText } from "./engine/types";
import type { LevelDef } from "./engine/types";
import { useSimulation } from "./hooks/useSimulation";
import { ApiReference } from "./ui/ApiReference";
import { CodeEditor } from "./ui/Editor";
import { MetricsBar, SimView } from "./ui/SimView";

/* Level records: the player's best stats per level, persisted in localStorage.
   All four are tracked independently (each may come from a different run). */
interface LevelRecord {
  succeeded: boolean;
  bestTime?: number; // seconds to reach the quota (lower is better)
  bestAvgWait?: number; // (lower)
  bestMaxWait?: number; // (lower)
  bestDelivered?: number; // (higher)
}

const recordKey = (levelId: number) => `liftoff:record:${levelId}`;

function loadRecords(): Record<number, LevelRecord> {
  const out: Record<number, LevelRecord> = {};
  try {
    for (const l of LEVELS) {
      const raw = localStorage.getItem(recordKey(l.id));
      if (raw) out[l.id] = JSON.parse(raw) as LevelRecord;
    }
  } catch {
    // storage unavailable — empty records
  }
  return out;
}

function saveRecord(levelId: number, rec: LevelRecord): void {
  try {
    localStorage.setItem(recordKey(levelId), JSON.stringify(rec));
  } catch {
    // ignore
  }
}

/** Quota levels end the moment the count is reached; other formats run to the limit. */
function isQuotaLevel(level: LevelDef): boolean {
  return level.goals.every((g) => g.kind === "deliver");
}

const GLOBAL_CODE_KEY = "liftoff:code";
/** Per-era leftover keys: the editor used per-level buffers before going global. */
const legacyCodeKey = (levelId: number) => `liftoff:code:${levelId}`;

/**
 * The editor buffer is global: one piece of player code shared across all
 * levels. Restored on refresh; migrated once from the old per-level keys.
 */
function loadCode(): string {
  try {
    const global = localStorage.getItem(GLOBAL_CODE_KEY);
    if (global !== null) return global;
    const legacy = localStorage.getItem(legacyCodeKey(1));
    if (legacy !== null) {
      localStorage.setItem(GLOBAL_CODE_KEY, legacy);
      for (const l of LEVELS) localStorage.removeItem(legacyCodeKey(l.id));
      return legacy;
    }
  } catch {
    // storage unavailable — fall through to the starter template
  }
  return DEFAULT_STARTER_CODE;
}

function saveCode(code: string): void {
  try {
    localStorage.setItem(GLOBAL_CODE_KEY, code);
  } catch {
    // storage unavailable — ignore
  }
}

export default function App() {
  const [levelId, setLevelId] = useState(1);
  const level = LEVELS.find((l) => l.id === levelId) ?? LEVELS[0];
  const [code, setCode] = useState(loadCode);
  const [showApi, setShowApi] = useState(true);
  const [records, setRecords] = useState<Record<number, LevelRecord>>(loadRecords);
  const [recordNote, setRecordNote] = useState<string | null>(null);
  const processedResultRef = useRef<string | null>(null);
  const sim = useSimulation();

  const running = sim.status === "running";

  // Level switches never touch the code buffer.
  const selectLevel = useCallback(
    (id: number) => {
      sim.stop();
      setLevelId(id);
    },
    [sim]
  );

  // Auto-save as the player types, so a refresh never loses in-progress work.
  useEffect(() => {
    const t = setTimeout(() => saveCode(code), 400);
    return () => clearTimeout(t);
  }, [code]);

  const run = useCallback(() => {
    saveCode(code);
    sim.start(code, level.id, 1);
  }, [code, level.id, sim]);

  const resetCode = useCallback(() => {
    sim.stop();
    setCode(DEFAULT_STARTER_CODE);
    saveCode(DEFAULT_STARTER_CODE);
  }, [sim]);

  // Update the level's records when a run finishes successfully.
  useEffect(() => {
    const result = sim.result;
    if (sim.status === "running" || sim.status === "idle") {
      // A new run is starting: reset the note so replays are judged fresh
      // (identical results are legitimate repeats, not stale notes).
      processedResultRef.current = null;
      if (recordNote !== null) setRecordNote(null);
      return;
    }
    if (sim.status !== "finished" || !result) return;
    const dupKey = `${level.id}:${result.snapshot.time.toFixed(3)}:${result.snapshot.delivered}`;
    if (processedResultRef.current === dupKey) return;
    processedResultRef.current = dupKey;

    if (!result.success || result.error) {
      setRecordNote(null);
      return;
    }

    const s = result.snapshot;
    const prev = records[level.id];
    const firstClear = !prev?.succeeded;
    const notes: string[] = [];
    if (firstClear || (prev.bestTime !== undefined && s.time < prev.bestTime))
      notes.push(` reaching the goal in ${s.time.toFixed(1)}s`);
    if (firstClear || (prev.bestAvgWait !== undefined && s.avgWait < prev.bestAvgWait))
      notes.push(` avg wait ${s.avgWait.toFixed(1)}s`);
    if (firstClear || (prev.bestMaxWait !== undefined && s.maxWait < prev.bestMaxWait))
      notes.push(` max wait ${s.maxWait.toFixed(1)}s`);
    const prevDelivered = prev?.succeeded ? prev.bestDelivered : undefined;
    if (!isQuotaLevel(level) || firstClear) {
      if (firstClear || (prevDelivered !== undefined && s.delivered > prevDelivered))
        notes.push(` ${s.delivered} passengers delivered`);
    }

    if (notes.length > 0) {
      const rec: LevelRecord = {
        succeeded: true,
        bestTime: firstClear ? s.time : Math.min(prev.bestTime ?? s.time, s.time),
        bestAvgWait: firstClear ? s.avgWait : Math.min(prev.bestAvgWait ?? s.avgWait, s.avgWait),
        bestMaxWait: firstClear ? s.maxWait : Math.min(prev.bestMaxWait ?? s.maxWait, s.maxWait),
        bestDelivered: isQuotaLevel(level)
          ? (firstClear ? s.delivered : Math.max(prev.bestDelivered ?? s.delivered, s.delivered))
          : s.delivered,
      };
      saveRecord(level.id, rec);
      setRecords({ ...records, [level.id]: rec });
      setRecordNote(firstClear ? "First clear!" : `New record!${notes.join(",")}`);
    } else {
      setRecordNote(null);
    }
  }, [sim.status, sim.result, level.id, records]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          LIFT<span className="accent">OFF</span>
        </h1>
        <nav className="level-tabs">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              className={`level-tab ${l.id === level.id ? "active" : ""} ${
                records[l.id]?.succeeded ? "solved" : ""
              }`}
              onClick={() => selectLevel(l.id)}
            >
              {l.id}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        <section className="editor-pane">
          <div className="toolbar">
            {running ? (
              <button className="btn btn-stop" onClick={sim.stop}>
                ■ Stop
              </button>
            ) : (
              <button className="btn btn-run" onClick={run}>
                ▶ Run <kbd>Ctrl+Enter</kbd>
              </button>
            )}
            <button
              className="btn"
              onClick={() => sim.setPaused(!sim.paused)}
              disabled={!running}
            >
              {sim.paused ? "Resume" : "Pause"}
            </button>
            <div className="speed-group">
              {[1, 2, 4, 8].map((s) => (
                <button
                  key={s}
                  className={`btn btn-speed ${sim.speed === s ? "active" : ""}`}
                  onClick={() => sim.setSpeed(s)}
                >
                  {s}×
                </button>
              ))}
            </div>
            <button
              className={`btn ${showApi ? "btn-api-active" : ""}`}
              onClick={() => setShowApi(!showApi)}
              title="Toggle API reference"
            >
              API
            </button>
            <button className="btn btn-ghost" onClick={resetCode} title="Reset to starter code">
              Reset code
            </button>
          </div>
          <div className="editor-wrap">
            <CodeEditor value={code} onChange={setCode} onRun={run} />
          </div>
          {showApi && <ApiReference />}
        </section>

        <section className="sim-pane">
          <div className="level-info">
            <h2>
              Level {level.id}: {level.name}
            </h2>
            <p>{level.description}</p>
            <ul className="goals">
              {level.goals.map((g, i) => (
                <li key={i}>{goalText(g)}</li>
              ))}
              <li>Time limit: {level.timeLimitSeconds}s</li>
            </ul>
            {level.hint && <p className="hint">💡 {level.hint}</p>}
            {records[level.id]?.succeeded ? (
              <p className="record-line">
                ✅ Solved — records:{" "}
                {records[level.id].bestTime !== undefined &&
                  `goal in ${records[level.id].bestTime!.toFixed(1)}s`}
                {records[level.id].bestAvgWait !== undefined &&
                  ` · avg wait ${records[level.id].bestAvgWait!.toFixed(1)}s`}
                {records[level.id].bestMaxWait !== undefined &&
                  ` · max wait ${records[level.id].bestMaxWait!.toFixed(1)}s`}
                {!isQuotaLevel(level) &&
                  records[level.id].bestDelivered !== undefined &&
                  ` · best delivered ${records[level.id].bestDelivered}`}
              </p>
            ) : (
              <p className="record-line record-unsolved">Not solved yet</p>
            )}
          </div>

          <MetricsBar snapshotRef={sim.snapshotRef} timeLimit={level.timeLimitSeconds} />

          <div className="canvas-wrap">
            <SimView
              snapshotRef={sim.snapshotRef}
              level={level}
              animSpeed={sim.paused ? 0 : sim.speed}
            />
          </div>

          {sim.status === "error" && sim.error && (
            <div className="banner banner-error">
              <strong>Error:</strong> {sim.error}
            </div>
          )}
          {sim.status === "finished" && sim.result && (
            <div className={`banner ${sim.result.success ? "banner-success" : "banner-fail"}`}>
              <strong>{sim.result.success ? "Level complete!" : "Not quite."}</strong>{" "}
              {sim.result.reason}
              {sim.result.success && recordNote && (
                <em className="record-note">{recordNote}</em>
              )}
              {sim.result.success && level.id < LEVELS.length && (
                <button className="btn btn-run" onClick={() => selectLevel(level.id + 1)}>
                  Next level →
                </button>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
