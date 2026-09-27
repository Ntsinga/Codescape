import { Html } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import { explainWhy, getFlow } from "../../api/client";
import type { EntryPoint, SemanticLink, WhyResult } from "../../api/types";
import { useExplorerStore, type ExplorerNode } from "../../state/store";
import { ARCHETYPE_GLYPH, ARCHETYPE_LABEL, archetypeOf, riskColor } from "../grammar";
import { formatMonth, type NodeHistory } from "../derive";
import type { Vec3 } from "../layout";

interface Props {
  node: ExplorerNode;
  position: Vec3;
  offset: number;
  history: NodeHistory | null;
  /** Ancestor chain lookup, to find entry points inside this node. */
  chainOf: (id: string) => string[];
}

interface Ref { id: string; name: string; weight: number }

function refs(links: SemanticLink[], nodesById: Map<string, ExplorerNode>, pick: (l: SemanticLink) => string): Ref[] {
  const out = new Map<string, Ref>();
  for (const l of links) {
    const id = pick(l);
    const n = nodesById.get(id);
    if (!n) continue;
    out.set(id, { id, name: n.name, weight: (out.get(id)?.weight ?? 0) + l.weight });
  }
  return [...out.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * The contextual hologram attached to the selected entity: what it is, how big,
 * what flows into and out of it, and the actions that let you go deeper —
 * Trace, Explode, Why?, Source. Dense detail stays in the side panel (2D).
 */
export function SystemCard({ node, position, offset, history, chainOf }: Props) {
  const repoId = useExplorerStore((s) => s.repoId);
  const links = useExplorerStore((s) => s.links);
  const entrypoints = useExplorerStore((s) => s.entrypoints);
  const nodesById = useExplorerStore((s) => s.nodesById);
  const childrenByParent = useExplorerStore((s) => s.childrenByParent);
  const selectNode = useExplorerStore((s) => s.selectNode);
  const setFocusNode = useExplorerStore((s) => s.setFocusNode);
  const setViewMode = useExplorerStore((s) => s.setViewMode);
  const setHighlight = useExplorerStore((s) => s.setHighlight);
  const setFlow = useExplorerStore((s) => s.setFlow);

  const [why, setWhy] = useState<WhyResult | null>(null);
  const [whyLoading, setWhyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracePick, setTracePick] = useState(false);

  useEffect(() => {
    setWhy(null);
    setError(null);
    setTracePick(false);
  }, [node.id]);

  const inputs = useMemo(() => refs(links.filter((l) => l.to === node.id), nodesById, (l) => l.from), [links, node.id, nodesById]);
  const outputs = useMemo(() => refs(links.filter((l) => l.from === node.id), nodesById, (l) => l.to), [links, node.id, nodesById]);
  const ownEntrypoints = useMemo<EntryPoint[]>(
    () => entrypoints.filter((e) => e.semanticId && chainOf(e.semanticId).includes(node.id)),
    [entrypoints, node.id, chainOf]
  );

  const a = archetypeOf(node);
  const m = node.metrics;
  const hasChildren = (childrenByParent.get(node.id)?.length ?? 0) > 0;
  const isMap = Boolean(node.archetype);
  const dataEntities = useMemo(() => {
    if (!isMap) return 0;
    let count = 0;
    const stack = [node.id];
    while (stack.length) {
      const id = stack.pop()!;
      for (const c of childrenByParent.get(id) ?? []) {
        if (c.type === "Unit" && c.archetype === "Data") count++;
        stack.push(c.id);
      }
    }
    return count;
  }, [node.id, childrenByParent, isMap]);

  async function runWhy() {
    if (!repoId) return;
    setWhyLoading(true);
    setError(null);
    try {
      const result = await explainWhy(repoId, node.id);
      setWhy(result);
      setHighlight({ ids: [node.id, ...result.usedBy.map((r) => r.id), ...result.dependsOn.map((r) => r.id)], label: `Why ${node.name}?` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Explanation failed");
    } finally {
      setWhyLoading(false);
    }
  }

  async function runTrace(ep?: EntryPoint) {
    if (!repoId) return;
    const target = ep ?? (ownEntrypoints.length === 1 ? ownEntrypoints[0] : undefined);
    if (!target) {
      if (ownEntrypoints.length > 1) { setTracePick(true); return; }
      // No routes inside: trace its relationships instead.
      setHighlight({ ids: [node.id, ...inputs.map((r) => r.id), ...outputs.map((r) => r.id)], label: `Relationships of ${node.name}` });
      return;
    }
    setTracePick(false);
    setError(null);
    try { setFlow(await getFlow(repoId, target.id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Trace failed"); }
  }

  const risk = m ? riskColor(m.risk) : null;

  return (
    <Html position={[position[0] + offset, position[1] + offset * 0.4, position[2]]} style={{ pointerEvents: "auto" }} zIndexRange={[30, 20]}>
      <div className="system-card" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <div className="sc-head">
          <span className="sc-glyph">{isMap ? ARCHETYPE_GLYPH[a] : "•"}</span>
          <div className="sc-title">
            <div className="sc-name">{node.name}</div>
            <div className="sc-kind">
              {isMap ? ARCHETYPE_LABEL[a] : node.type}
              {node.kind && node.kind !== a && node.kind !== "Area" && node.kind !== "File" ? ` · ${node.kind}` : ""}
              {node.layerArchetype && a === "Domain" ? ` · lives in ${ARCHETYPE_LABEL[node.layerArchetype]}` : ""}
            </div>
          </div>
          <button className="sc-close" onClick={() => selectNode(null)} title="Close">×</button>
        </div>

        {node.summary && <p className="sc-summary">{why?.purpose || node.summary}</p>}

        {m && (
          <div className="sc-metrics">
            {m.files > 0 && <span><b>{m.files}</b> files</span>}
            {m.functions > 0 && <span><b>{m.functions}</b> functions</span>}
            <span><b>{m.fanOut}</b> dependencies</span>
            <span><b>{m.fanIn}</b> dependents</span>
            {m.entrypoints > 0 && <span><b>{m.entrypoints}</b> endpoints</span>}
            {dataEntities > 0 && <span><b>{dataEntities}</b> data files</span>}
            {risk && <span style={{ color: risk }} title={m.riskReasons.join("\n")}><b>{m.risk}</b> risk</span>}
            {m.unusedCandidate && <span className="sc-warn" title="Nothing outside it references it. Framework entry points can be false positives.">unused?</span>}
            {m.isolated && <span className="sc-warn">isolated</span>}
          </div>
        )}
        {history && (
          <div className="sc-history">appeared {formatMonth(history.firstSeen)} · {history.commits} commits</div>
        )}

        {(inputs.length > 0 || outputs.length > 0) && (
          <div className="sc-io">
            <div>
              <div className="sc-label">Inputs</div>
              {inputs.slice(0, 5).map((r) => <button key={r.id} className="sc-ref" onClick={() => selectNode(r.id)}>{r.name}</button>)}
              {inputs.length === 0 && <span className="sc-muted">none</span>}
            </div>
            <div>
              <div className="sc-label">Outputs</div>
              {outputs.slice(0, 5).map((r) => <button key={r.id} className="sc-ref" onClick={() => selectNode(r.id)}>{r.name}</button>)}
              {outputs.length === 0 && <span className="sc-muted">none</span>}
            </div>
          </div>
        )}

        {why && (
          <div className="sc-why">
            <div className="sc-label">Why it exists {why.aiUsed ? "· AI" : ""}</div>
            {why.affects.length > 0 && <div className="sc-line"><b>Affects</b> {why.affects.map((r) => r.name).join(", ")}</div>}
            {why.usedBy.length > 0 && <div className="sc-line"><b>Used by</b> {why.usedBy.slice(0, 6).map((r) => r.name).join(", ")}</div>}
            {why.dependsOn.length > 0 && <div className="sc-line"><b>Depends on</b> {why.dependsOn.slice(0, 6).map((r) => r.name).join(", ")}</div>}
            {why.notes.map((n, i) => <div key={i} className="sc-note">• {n}</div>)}
          </div>
        )}

        {tracePick && (
          <div className="sc-trace-pick">
            <div className="sc-label">Trace which endpoint?</div>
            {ownEntrypoints.slice(0, 12).map((e) => (
              <button key={e.id} className="sc-ref mono" onClick={() => runTrace(e)}>{e.label}</button>
            ))}
          </div>
        )}
        {error && <div className="sc-error">{error}</div>}

        {isMap && (
          <div className="sc-actions">
            <button onClick={() => runTrace()} title={ownEntrypoints.length ? "Trace a request through the system" : "Light up what it's connected to"}>Trace</button>
            {hasChildren && <button onClick={() => setFocusNode(node.id)} title="Open it up to the next level">Explode</button>}
            {node.type !== "System" && node.type !== "External" && (
              <button onClick={runWhy} disabled={whyLoading}>{whyLoading ? "Thinking…" : "Why?"}</button>
            )}
            {node.filePath && node.type !== "Concept" && <button onClick={() => setViewMode("source")}>Source</button>}
          </div>
        )}
      </div>
    </Html>
  );
}
