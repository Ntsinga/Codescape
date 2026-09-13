import { useEffect, useMemo, useState } from "react";
import { explainNode, getImpact } from "../api/client";
import type { ExplainResult, ImpactResult } from "../api/types";
import { useExplorerStore } from "../state/store";

export function NodeDetailPanel() {
  const repoId = useExplorerStore((s) => s.repoId);
  const selectedNodeId = useExplorerStore((s) => s.selectedNodeId);
  const nodesById = useExplorerStore((s) => s.nodesById);
  const edges = useExplorerStore((s) => s.edges);
  const selectNode = useExplorerStore((s) => s.selectNode);
  const setViewMode = useExplorerStore((s) => s.setViewMode);
  const setFocusNode = useExplorerStore((s) => s.setFocusNode);
  const childrenByParent = useExplorerStore((s) => s.childrenByParent);

  const [explaining, setExplaining] = useState(false);
  const [explainResult, setExplainResult] = useState<ExplainResult | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);

  const node = selectedNodeId ? nodesById.get(selectedNodeId) : null;

  useEffect(() => {
    setExplainResult(null);
    setExplainError(null);
    setImpact(null);
    setImpactError(null);
  }, [selectedNodeId]);

  const { outgoing, incoming } = useMemo(() => {
    if (!node) return { outgoing: [], incoming: [] };
    return {
      outgoing: edges.filter((e) => e.fromNodeId === node.id),
      incoming: edges.filter((e) => e.toNodeId === node.id),
    };
  }, [edges, node]);

  if (!node) {
    return (
      <div className="detail-panel">
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>Select a node to see its details.</p>
      </div>
    );
  }

  // Physical node id backing this node (semantic leaves carry it; physical nodes are themselves).
  const backingId = node.physicalNodeId ?? node.id;

  async function handleExplain() {
    if (!repoId || !node) return;
    setExplaining(true);
    setExplainError(null);
    try {
      const result = await explainNode(repoId, node.physicalNodeId ?? node.id);
      setExplainResult(result);
    } catch (err) {
      setExplainError(err instanceof Error ? err.message : "Failed to explain");
    } finally {
      setExplaining(false);
    }
  }

  async function handleImpact() {
    if (!repoId || !node) return;
    setImpactLoading(true);
    setImpactError(null);
    try { setImpact(await getImpact(repoId, node.physicalNodeId ?? node.id)); }
    catch (err) { setImpactError(err instanceof Error ? err.message : "Failed to calculate impact"); }
    finally { setImpactLoading(false); }
  }

  const canExplain = Boolean(node.filePath && node.startLine !== null && backingId);
  const canImpact = Boolean(node.physicalNodeId ?? (edges.length > 0 ? node.id : null));

  return (
    <div className="detail-panel">
      <h2>{node.name}</h2>
      <div className="badge-row">
        <span className="kind-badge">{node.kind ?? node.type}</span>
        {node.role && node.role !== "Core" && <span className="role-badge">{node.role}</span>}
        {node.capability && <span className="capability-badge">{node.capability}</span>}
        {node.source === "ai-enriched" && typeof node.confidence === "number" && (
          <span className="confidence-tag">{Math.round(node.confidence * 100)}% AI</span>
        )}
      </div>
      {node.summary && <p className="node-summary">{node.summary}</p>}
      {node.filePath && (
        <div className="file-ref">
          {node.filePath}
          {node.startLine ? `:${node.startLine}-${node.endLine}` : ""}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {node.filePath && (
          <button type="button" onClick={() => setViewMode("source")}>
            View source
          </button>
        )}
        {(childrenByParent.get(node.id)?.length ?? 0) > 0 && (
          <button type="button" onClick={() => setFocusNode(node.id)}>
            Zoom in
          </button>
        )}
      </div>

      {canExplain && (
        <section>
          <h3>AI Explanation</h3>
          {!explainResult && (
            <button type="button" onClick={handleExplain} disabled={explaining}>
              {explaining ? "Explaining…" : "Explain this " + node.type.toLowerCase()}
            </button>
          )}
          {explainError && <p style={{ color: "var(--red)", fontSize: 12 }}>{explainError}</p>}
          {explainResult && (
            <div className="explain-box">
              {explainResult.explanation}
              <div className="evidence-list">
                Evidence: {explainResult.evidence.map((e) => `${e.file}:${e.startLine}-${e.endLine}`).join(", ")}
              </div>
            </div>
          )}
        </section>
      )}

      {canImpact && <section>
        <h3>Impact analysis</h3>
        {!impact && <button type="button" onClick={handleImpact} disabled={impactLoading}>{impactLoading ? "Calculating…" : "Find dependents"}</button>}
        {impactError && <p style={{ color: "var(--red)", fontSize: 12 }}>{impactError}</p>}
        {impact && <>
          <p style={{ color: "var(--text-dim)", fontSize: 12 }}>{impact.impacted.length} dependent node{impact.impacted.length === 1 ? "" : "s"} found.</p>
          <ul className="edge-list">{impact.impacted.map((item) => <li key={item.node.id} onClick={() => selectNode(item.node.id)}>{item.node.name}<span className="confidence-tag">depth {item.depth}</span></li>)}</ul>
        </>}
      </section>}

      {outgoing.length > 0 && (
        <section>
          <h3>References out ({outgoing.length})</h3>
          <ul className="edge-list">
            {outgoing.map((e) => {
              const target = nodesById.get(e.toNodeId);
              if (!target) return null;
              return (
                <li key={e.id} onClick={() => selectNode(target.id)}>
                  {e.type} → {target.name}
                  <span className={`confidence-tag ${e.confidence}`}>{e.confidence}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {incoming.length > 0 && (
        <section>
          <h3>Referenced by ({incoming.length})</h3>
          <ul className="edge-list">
            {incoming.map((e) => {
              const source = nodesById.get(e.fromNodeId);
              if (!source) return null;
              return (
                <li key={e.id} onClick={() => selectNode(source.id)}>
                  {source.name} —{e.type}→
                  <span className={`confidence-tag ${e.confidence}`}>{e.confidence}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
