import { useEffect, useRef, useState } from "react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { SearchBar } from "../components/SearchBar";
import { Graph2D } from "../components/Graph2D";
import { Graph3DScene } from "../components/Graph3DScene";
import { SourceViewer } from "../components/SourceViewer";
import { NodeDetailPanel } from "../components/NodeDetailPanel";
import { LiveDiagram } from "../components/LiveDiagram";
import { useExplorerStore } from "../state/store";
import { analyzeRepository, decomposeRepository, getRisks, getStack } from "../api/client";
import type { ArchitectureResult, RiskResult, StackResult } from "../api/types";

function fmtEvidence(e: { file: string; startLine: number | null; endLine: number | null }): string {
  if (e.startLine == null || e.endLine == null) return e.file;
  return `${e.file}:${e.startLine}-${e.endLine}`;
}

export function ExplorerView() {
  const viewMode = useExplorerStore((s) => s.viewMode);
  const setViewMode = useExplorerStore((s) => s.setViewMode);
  const layer = useExplorerStore((s) => s.layer);
  const setLayer = useExplorerStore((s) => s.setLayer);
  const repoName = useExplorerStore((s) => s.repoName);
  const repoId = useExplorerStore((s) => s.repoId);
  const aiEnriched = useExplorerStore((s) => s.aiEnriched);
  const setSemantic = useExplorerStore((s) => s.setSemantic);
  const reset = useExplorerStore((s) => s.reset);

  const [enriching, setEnriching] = useState(false);
  const [enrichNote, setEnrichNote] = useState<string | null>(null);
  const enrichAttempted = useRef<string | null>(null);

  const [insightsOpen, setInsightsOpen] = useState(false);
  const [analysis, setAnalysis] = useState<ArchitectureResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [risks, setRisks] = useState<RiskResult | null>(null);
  const [stack, setStack] = useState<StackResult | null>(null);
  const [diagramType, setDiagramType] = useState<"all" | "Imports" | "Calls">("all");

  // Auto-run AI naming once per repo when the map isn't enriched yet.
  useEffect(() => {
    if (!repoId || aiEnriched || enrichAttempted.current === repoId) return;
    enrichAttempted.current = repoId;
    setEnriching(true);
    setEnrichNote(null);
    decomposeRepository(repoId, true)
      .then((tree) => {
        setSemantic({ nodes: tree.nodes, aiEnriched: tree.aiEnriched });
        if (!tree.aiEnriched) setEnrichNote(tree.enrichmentError ?? "AI naming unavailable — showing structural names.");
      })
      .catch((err) => setEnrichNote(err instanceof Error ? err.message : "AI naming failed"))
      .finally(() => setEnriching(false));
  }, [repoId, aiEnriched, setSemantic]);

  useEffect(() => {
    if (!repoId) return;
    getRisks(repoId).then(setRisks).catch(() => undefined);
    getStack(repoId).then(setStack).catch(() => undefined);
  }, [repoId]);

  async function runAnalysis() {
    if (!repoId) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      setAnalysis(await analyzeRepository(repoId));
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="brand" onClick={reset} title="Back to repositories">Codescape</span>
        <span className="repo-name">{repoName}</span>
        <Breadcrumbs />

        <div className="topbar-cluster">
          {enriching && <span className="ai-pill">✦ Naming with AI…</span>}

          <div className="seg-toggle" role="group" aria-label="Layer">
            <button className={layer === "semantic" ? "active" : ""} onClick={() => setLayer("semantic")} title="AI logical map">Map</button>
            <button className={layer === "files" ? "active" : ""} onClick={() => setLayer("files")} title="Raw file structure">Files</button>
          </div>

          <div className="seg-toggle" role="group" aria-label="View">
            <button className={viewMode === "3d" ? "active" : ""} onClick={() => setViewMode("3d")}>3D</button>
            <button className={viewMode === "2d" ? "active" : ""} onClick={() => setViewMode("2d")}>2D</button>
            <button className={viewMode === "source" ? "active" : ""} onClick={() => setViewMode("source")}>Source</button>
          </div>

          <SearchBar />
          <button className="ghost-btn" onClick={() => setInsightsOpen((v) => !v)}>Insights</button>
        </div>
      </div>

      <div className="layer-hint">
        <span className="hint-text">
          {layer === "semantic"
            ? enrichNote
              ? enrichNote
              : "Conceptual map: Concept → File → Function. Double-click to go deeper; double-click a function to read its code."
            : "File structure: folders → files → classes → functions."}
        </span>
        {stack && (stack.languages.length > 0 || stack.frameworks.length > 0) && (
          <span className="stack-strip">
            {stack.languages.map((l) => (
              <span key={l.name} className="stack-chip lang" title={`${l.files} files`}>{l.name}</span>
            ))}
            {stack.frameworks.map((f) => (
              <span key={f.name} className="stack-chip fw">{f.name}</span>
            ))}
          </span>
        )}
      </div>

      <div className="main-area">
        <div className="center-panel">
          {viewMode === "3d" && <Graph3DScene />}
          {viewMode === "2d" && <Graph2D />}
          {viewMode === "source" && <SourceViewer />}
        </div>
        <NodeDetailPanel />
      </div>

      {insightsOpen && (
        <aside className="insights-panel">
          <div className="insights-head">
            <h2>Insights</h2>
            <button className="ghost-btn" onClick={() => setInsightsOpen(false)}>✕</button>
          </div>

          <section>
            <h3>Tech stack</h3>
            {stack && (stack.languages.length > 0 || stack.frameworks.length > 0) ? (
              <>
                <div className="stack-group">
                  <span className="stack-label">Languages</span>
                  <div className="stack-chips">
                    {stack.languages.map((l) => (
                      <span key={l.name} className="stack-chip lang">{l.name} <em>{l.files}</em></span>
                    ))}
                  </div>
                </div>
                <div className="stack-group">
                  <span className="stack-label">Frameworks</span>
                  <div className="stack-chips">
                    {stack.frameworks.length ? (
                      stack.frameworks.map((f) => <span key={f.name} className="stack-chip fw">{f.name}</span>)
                    ) : (
                      <span className="muted">None detected from manifests.</span>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="muted">No language or framework signals detected.</p>
            )}
          </section>

          <section>
            <div className="section-head">
              <h3>Architecture &amp; domains</h3>
              <button className="ghost-btn sm" onClick={runAnalysis} disabled={analyzing}>
                {analyzing ? "Analyzing…" : analysis ? "Re-run" : "Analyze"}
              </button>
            </div>
            {analysisError && <p className="err">{analysisError}</p>}
            {!analysis && !analyzing && <p className="muted">Run an evidence-backed AI pass over the graph to surface architectural components and domains.</p>}
            {analysis && (
              <>
                <p className="muted">{analysis.summary}</p>
                {analysis.findings.map((f) => (
                  <article key={f.title}>
                    <div className="finding-head">
                      <strong>{f.title}</strong>
                      <span className="confidence-tag">{Math.round(f.confidence * 100)}%</span>
                    </div>
                    <p>{f.summary}</p>
                    <small>{f.evidence.map(fmtEvidence).join(" · ")}</small>
                  </article>
                ))}
              </>
            )}
          </section>

          <section>
            <h3>Risk hotspots</h3>
            {risks?.risks.length ? (
              risks.risks.slice(0, 6).map((risk) => (
                <article key={risk.node.id}>
                  <div className="finding-head">
                    <strong>{risk.node.name}</strong>
                    <span className="risk-score">{risk.score}</span>
                  </div>
                  <p>{risk.reasons.join(" · ")}</p>
                </article>
              ))
            ) : (
              <p className="muted">No high-risk hotspots detected.</p>
            )}
          </section>

          <section>
            <h3>Dependency diagram</h3>
            <div className="diagram-filters">
              {(["all", "Imports", "Calls"] as const).map((type) => (
                <button key={type} className={diagramType === type ? "active" : ""} onClick={() => setDiagramType(type)}>{type}</button>
              ))}
            </div>
            <LiveDiagram edgeType={diagramType} nodeType="all" />
          </section>
        </aside>
      )}
    </div>
  );
}
