import { useEffect, useMemo, useRef, useState } from "react";
import { collectHistory, getFlow, getHistory } from "../../api/client";
import { useExplorerStore } from "../../state/store";
import { ARCHETYPE_GLYPH, LAYERS, LEVEL_META, PALETTE, layerY, type Level } from "../grammar";
import { formatMonth } from "../derive";
import type { SceneLayout } from "../layout";

/**
 * The 2D half of the interface. The 3D world says where things are and how
 * they relate; these flat panels say what they mean — level, legend, flows,
 * health, time — and stay out of the way until they're relevant.
 */

// ---- Level indicator ---------------------------------------------------------

export function LevelIndicator({ level }: { level: Level }) {
  const meta = LEVEL_META[level];
  return (
    <div className="hud-level">
      <div className="hud-level-steps">
        {([1, 2, 3, 4] as Level[]).map((l) => (
          <span key={l} className={l === level ? "on" : l < level ? "past" : ""}>{LEVEL_META[l].name}</span>
        ))}
      </div>
      <div className="hud-level-text">{meta.shows}{meta.next ? <span className="hud-dim"> · {meta.next}</span> : null}</div>
    </div>
  );
}

// ---- Toolbar -----------------------------------------------------------------

export function HudToolbar({ flowsOpen, onToggleFlows, timelineOpen, onToggleTimeline }: { flowsOpen: boolean; onToggleFlows: () => void; timelineOpen: boolean; onToggleTimeline: () => void }) {
  const overlay = useExplorerStore((s) => s.overlay);
  const setOverlay = useExplorerStore((s) => s.setOverlay);
  const entrypoints = useExplorerStore((s) => s.entrypoints);
  const highlight = useExplorerStore((s) => s.highlight);
  const setHighlight = useExplorerStore((s) => s.setHighlight);
  const flow = useExplorerStore((s) => s.flow);
  return (
    <div className="hud-toolbar">
      <button className={flowsOpen ? "active" : ""} onClick={onToggleFlows} title="Trace a request through the system">
        Flows{entrypoints.length ? ` · ${entrypoints.length}` : ""}
      </button>
      <button className={overlay === "health" ? "active" : ""} onClick={() => setOverlay(overlay === "health" ? "none" : "health")} title="Architectural weather: risk, coupling, churn, unused, central, isolated">
        Health
      </button>
      <button className={timelineOpen ? "active" : ""} onClick={onToggleTimeline} title="Watch the architecture change over time">
        Time
      </button>
      {(highlight || flow) && (
        <span className="hud-chip">
          {flow ? `Tracing ${flow.entrypoint.label}` : highlight!.label}
          <button onClick={() => { setHighlight(null); useExplorerStore.getState().setFlow(null); }} title="Clear">×</button>
        </span>
      )}
    </div>
  );
}

// ---- Flow panel --------------------------------------------------------------

export function FlowPanel({ onClose }: { onClose: () => void }) {
  const repoId = useExplorerStore((s) => s.repoId);
  const entrypoints = useExplorerStore((s) => s.entrypoints);
  const flow = useExplorerStore((s) => s.flow);
  const setFlow = useExplorerStore((s) => s.setFlow);
  const nodesById = useExplorerStore((s) => s.nodesById);
  const selectNode = useExplorerStore((s) => s.selectNode);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entrypoints.filter((e) => !q || e.label.toLowerCase().includes(q) || e.filePath.toLowerCase().includes(q)).slice(0, 80);
  }, [entrypoints, query]);

  async function pick(id: string) {
    if (!repoId) return;
    setLoading(id);
    setError(null);
    try { setFlow(await getFlow(repoId, id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Trace failed"); }
    finally { setLoading(null); }
  }

  /** Select the deepest visible-or-known semantic node for a step. */
  function focusStep(chain: string[]) {
    const id = chain.find((c) => nodesById.has(c));
    if (id) selectNode(id);
  }

  return (
    <div className="hud-panel hud-flows" onPointerDown={(e) => e.stopPropagation()}>
      <div className="hud-panel-head">
        <span>{flow ? "Flow" : "Entry points"}</span>
        <button onClick={flow ? () => setFlow(null) : onClose}>{flow ? "← All" : "×"}</button>
      </div>
      {!flow && (
        <>
          {entrypoints.length === 0 ? (
            <p className="hud-dim">No routes detected. Flows start from HTTP routes (Express/Fastify, FastAPI/Flask/Django, ASP.NET).</p>
          ) : (
            <>
              <input className="hud-search" placeholder="Filter routes…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <ul className="hud-list">
                {filtered.map((e) => (
                  <li key={e.id} onClick={() => pick(e.id)}>
                    <span className={`method m-${e.method.toLowerCase()}`}>{e.method}</span>
                    <span className="mono">{e.path}</span>
                    {loading === e.id && <span className="hud-dim"> …</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && <p className="sc-error">{error}</p>}
        </>
      )}
      {flow && (
        <>
          <div className="mono hud-flow-title">{flow.entrypoint.label}</div>
          <p className="hud-dim hud-policy">{flow.policy}</p>
          <ol className="hud-steps">
            {flow.steps.map((s) => (
              <li key={s.nodeId} style={{ paddingLeft: Math.min(6, s.depth - 1) * 10 }} onClick={() => focusStep(s.semanticChain)}>
                <span className={`conf conf-${s.confidence}`} title={s.confidence === "file-import" ? "The file imports this system; the exact call isn't resolved" : s.confidence}>
                  {s.confidence === "statically-confirmed" ? "●" : s.confidence === "framework-derived" ? "◌" : "⟁"}
                </span>
                <span className="mono">{s.name}</span>
              </li>
            ))}
            {flow.steps.length === 0 && <li className="hud-dim">No resolved calls from this handler.</li>}
          </ol>
          {flow.truncated && <p className="hud-dim">Path truncated (depth/size limit).</p>}
          {flow.unresolvedCalls.length > 0 && (
            <p className="hud-dim">Path ends at unresolved calls: <span className="mono">{flow.unresolvedCalls.slice(0, 10).join(", ")}</span></p>
          )}
          <div className="hud-key"><span>● confirmed</span><span>◌ name-matched</span><span>⟁ file import</span></div>
        </>
      )}
    </div>
  );
}

// ---- Legend: the visual grammar ---------------------------------------------

const SHAPES: Array<{ glyph: string; label: string; form: string }> = [
  { glyph: ARCHETYPE_GLYPH.Domain, label: "Domain", form: "glass volume, orbiting parts" },
  { glyph: ARCHETYPE_GLYPH.Interface, label: "Interface", form: "floating screen" },
  { glyph: ARCHETYPE_GLYPH.Gateway, label: "API / Gateway", form: "portal ring" },
  { glyph: ARCHETYPE_GLYPH.Service, label: "Service", form: "core with spokes" },
  { glyph: ARCHETYPE_GLYPH.Logic, label: "Logic", form: "octahedral frame" },
  { glyph: ARCHETYPE_GLYPH.Data, label: "Data", form: "reservoir discs" },
  { glyph: ARCHETYPE_GLYPH.External, label: "External", form: "amber portal" },
];

export function Legend({ semantic }: { semantic: boolean }) {
  const overlay = useExplorerStore((s) => s.overlay);
  const [open, setOpen] = useState(true);
  if (!semantic) {
    return (
      <div className="legend">
        <div className="legend-title">Files layer</div>
        <div className="legend-item">📁 folder · file · {"{ }"} class · {"<>"} interface · ƒ function</div>
      </div>
    );
  }
  return (
    <div className="legend">
      <button className="legend-title" onClick={() => setOpen((v) => !v)}>{overlay === "health" ? "Health" : "Visual language"} {open ? "▾" : "▸"}</button>
      {open && overlay !== "health" && (
        <>
          {SHAPES.map((s) => (
            <div key={s.label} className="legend-item"><span className="lg-glyph">{s.glyph}</span><span>{s.label}</span><span className="hud-dim">{s.form}</span></div>
          ))}
          <div className="legend-sep" />
          <div className="legend-item"><span className="lg-key">height</span>architecture layer</div>
          <div className="legend-item"><span className="lg-key">size</span>scope (files, lines)</div>
          <div className="legend-item"><span className="lg-key">colour</span>domain</div>
          <div className="legend-item"><span className="lg-key">line width</span>dependency strength</div>
          <div className="legend-item"><span className="lg-key">motion</span>direction of flow</div>
          <div className="legend-item"><span className="lg-key">dashed</span>inferred / external</div>
          <div className="legend-item"><span className="lg-key">halo</span>AI confidence · centrality</div>
          <div className="legend-item"><span className="lg-key">glass</span>more abstract</div>
        </>
      )}
      {open && overlay === "health" && (
        <>
          <div className="legend-item"><span className="lg-swatch" style={{ background: PALETTE.amber }} />risk (amber → red ring)</div>
          <div className="legend-item"><span className="lg-key">ticks</span>coupling (many neighbours)</div>
          <div className="legend-item"><span className="lg-key">sparks</span>recently changed (needs history)</div>
          <div className="legend-item"><span className="lg-key">faded</span>unused candidate</div>
          <div className="legend-item"><span className="lg-key">larger</span>highly central</div>
          <div className="legend-item"><span className="lg-key">rim</span>isolated (no links)</div>
          <div className="legend-item hud-dim">calm = healthy</div>
        </>
      )}
    </div>
  );
}

// ---- Minimap: side view (layers) + top view ---------------------------------

export function Minimap({ layout }: { layout: SceneLayout }) {
  const selectedNodeId = useExplorerStore((s) => s.selectedNodeId);
  const all = [...layout.placed, ...layout.anchors];
  const r = Math.max(1, layout.radius + 4);
  return (
    <div className="minimap">
      {layout.mode === "layered" && (
        <svg viewBox="-60 -40 120 80" className="mm-side">
          {LAYERS.filter((l) => layout.layers.includes(l.index)).map((l) => {
            const y = -(layerY(l.index) / (layerY(0) + 2)) * 32;
            return <line key={l.index} x1={-56} x2={56} y1={y + 4} y2={y + 4} stroke="#1f2a38" strokeWidth={0.6} />;
          })}
          {all.map((p) => (
            <circle key={p.node.id} cx={(p.position[0] / r) * 54} cy={-(p.position[1] / (layerY(0) + 2)) * 32} r={p.node.id === selectedNodeId ? 2.6 : 1.6} fill={p.node.id === selectedNodeId ? PALETTE.white : PALETTE.cyan} opacity={0.8} />
          ))}
        </svg>
      )}
      <svg viewBox="-60 -60 120 120" className="mm-top">
        <circle cx={0} cy={0} r={2} fill="var(--accent)" />
        {all.map((p) => (
          <circle key={p.node.id} cx={(p.position[0] / r) * 54} cy={(p.position[2] / r) * 54} r={p.node.id === selectedNodeId ? 3 : 1.8} fill={p.node.id === selectedNodeId ? PALETTE.white : p.node.type === "External" ? PALETTE.amber : PALETTE.cyan} opacity={0.85} />
        ))}
      </svg>
    </div>
  );
}

// ---- Timeline ----------------------------------------------------------------

export function Timeline() {
  const repoId = useExplorerStore((s) => s.repoId);
  const history = useExplorerStore((s) => s.history);
  const setHistory = useExplorerStore((s) => s.setHistory);
  const timeCursor = useExplorerStore((s) => s.timeCursor);
  const setTimeCursor = useExplorerStore((s) => s.setTimeCursor);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  // Load (and poll while collecting).
  useEffect(() => {
    if (!repoId) return;
    let cancelled = false;
    const load = () =>
      getHistory(repoId)
        .then((h) => {
          if (cancelled) return;
          setHistory(h);
          if (h.collecting) poll.current = window.setTimeout(load, 4000);
        })
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load history"));
    load();
    return () => {
      cancelled = true;
      if (poll.current) window.clearTimeout(poll.current);
    };
  }, [repoId, setHistory]);

  const range = history?.available && history.range ? { start: Date.parse(history.range.start), end: Date.parse(history.range.end) } : null;

  // Play: sweep from start to present over ~12s.
  useEffect(() => {
    if (!playing || !range) return;
    const step = (range.end - range.start) / 240;
    const id = window.setInterval(() => {
      const cur = useExplorerStore.getState().timeCursor ?? range.start;
      const next = cur + step;
      if (next >= range.end) { setTimeCursor(null); setPlaying(false); }
      else setTimeCursor(next);
    }, 50);
    return () => window.clearInterval(id);
  }, [playing, range?.start, range?.end, setTimeCursor]); // eslint-disable-line react-hooks/exhaustive-deps

  async function collect() {
    if (!repoId) return;
    setError(null);
    try {
      await collectHistory(repoId);
      setHistory({ available: false, collecting: true, reason: "Collecting git history…", files: {} });
      window.setTimeout(() => getHistory(repoId).then(setHistory).catch(() => undefined), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start history collection");
    }
  }

  if (!range) {
    return (
      <div className="hud-timeline off" onPointerDown={(e) => e.stopPropagation()}>
        <span className="hud-dim">{history?.reason ?? "Loading history…"}</span>
        {history?.canCollect && <button onClick={collect}>Collect history</button>}
        {error && <span className="sc-error">{error}</span>}
      </div>
    );
  }
  const value = timeCursor ?? range.end;
  return (
    <div className="hud-timeline" onPointerDown={(e) => e.stopPropagation()}>
      <button onClick={() => { if (!playing && timeCursor === null) setTimeCursor(range.start); setPlaying((p) => !p); }}>{playing ? "❚❚" : "▶"}</button>
      <span className="mono hud-dim">{formatMonth(range.start)}</span>
      <input type="range" min={range.start} max={range.end} step={(range.end - range.start) / 500 || 1} value={value} onChange={(e) => { setPlaying(false); setTimeCursor(Number(e.target.value)); }} />
      <span className="mono">{timeCursor === null ? "now" : formatMonth(value)}</span>
      <button onClick={() => { setPlaying(false); setTimeCursor(null); }} disabled={timeCursor === null}>Now</button>
      <span className="hud-dim hud-policy" title="Dependency dates would need every historical revision re-parsed.">links appear once both ends exist</span>
    </div>
  );
}
