import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { useEffect, useRef } from "react";
import type { ExplorerNode } from "../state/store";
import { useExplorerStore } from "../state/store";

type Tier = "focus" | "child" | "grandchild";

interface SimNode extends SimulationNodeDatum {
  id: string;
  node: ExplorerNode;
  tier: Tier;
  fx?: number | null;
  fy?: number | null;
}

const TYPE_COLOR: Record<string, string> = {
  System: "#f0b429",
  Concept: "#58a6ff",
  Group: "#2dd4bf",
  Unit: "#3fb950",
  Repository: "#58a6ff",
  Folder: "#8b949e",
  File: "#3fb950",
  Class: "#d29922",
  Interface: "#bc8cff",
  Function: "#f0883e",
  ImportedModule: "#6e7681",
};

const RADIUS: Record<Tier, number> = { focus: 15, child: 10, grandchild: 5 };

export function Graph2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focusNodeId = useExplorerStore((s) => s.focusNodeId);
  const nodesById = useExplorerStore((s) => s.nodesById);
  const childrenByParent = useExplorerStore((s) => s.childrenByParent);
  const selectNode = useExplorerStore((s) => s.selectNode);
  const setFocusNode = useExplorerStore((s) => s.setFocusNode);
  const focusParent = useExplorerStore((s) => s.focusParent);

  const nodesRef = useRef<SimNode[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !focusNodeId) return;
    const focusNode = nodesById.get(focusNodeId);
    const children = childrenByParent.get(focusNodeId) ?? [];
    if (!focusNode || children.length === 0) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Build a 3-tier tree: focus (hub) → children → grandchild preview.
    const simNodes: SimNode[] = [];
    const simLinks: Array<{ source: string; target: string; tier: Tier }> = [];

    const hub: SimNode = { id: focusNode.id, node: focusNode, tier: "focus", fx: width / 2, fy: height / 2, x: width / 2, y: height / 2 };
    simNodes.push(hub);

    const wide = children.length > 18;
    for (const child of children) {
      simNodes.push({ id: child.id, node: child, tier: "child" });
      simLinks.push({ source: focusNode.id, target: child.id, tier: "child" });
      if (wide) continue;
      const grand = childrenByParent.get(child.id) ?? [];
      for (const g of grand.slice(0, 5)) {
        simNodes.push({ id: g.id, node: g, tier: "grandchild" });
        simLinks.push({ source: child.id, target: g.id, tier: "grandchild" });
      }
    }

    nodesRef.current = simNodes;

    const simulation = forceSimulation(simNodes)
      .force("charge", forceManyBody().strength((d: any) => (d.tier === "grandchild" ? -80 : -520)))
      .force("collide", forceCollide((d: any) => RADIUS[(d as SimNode).tier] + 46))
      .force("x", forceX(width / 2).strength(0.04))
      .force("y", forceY(height / 2).strength(0.04))
      .force(
        "link",
        forceLink(simLinks as any)
          .id((d: any) => d.id)
          .distance((l: any) => (l.tier === "grandchild" ? 46 : 190))
          .strength((l: any) => (l.tier === "grandchild" ? 0.6 : 0.25))
      );

    function draw() {
      ctx.clearRect(0, 0, width, height);
      ctx.font = "11px sans-serif";

      for (const link of simLinks as any[]) {
        const s = link.source as SimNode;
        const t = link.target as SimNode;
        if (typeof s !== "object" || typeof t !== "object") continue;
        ctx.beginPath();
        ctx.moveTo(s.x ?? 0, s.y ?? 0);
        ctx.lineTo(t.x ?? 0, t.y ?? 0);
        ctx.strokeStyle = link.tier === "grandchild" ? "rgba(120,135,155,0.25)" : "rgba(120,150,190,0.5)";
        ctx.lineWidth = link.tier === "grandchild" ? 0.8 : 1.4;
        ctx.stroke();
      }

      for (const n of simNodes) {
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        const r = RADIUS[n.tier];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = TYPE_COLOR[n.node.type] ?? "#888";
        ctx.fill();
        if (n.tier === "focus") {
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#e6edf3";
          ctx.stroke();
        }
        if (n.tier !== "grandchild") {
          ctx.fillStyle = "#e6edf3";
          ctx.font = n.tier === "focus" ? "600 12px sans-serif" : "11px sans-serif";
          ctx.fillText(n.node.name, x + r + 4, y + 4);
        }
      }
    }

    simulation.on("tick", draw);
    return () => { simulation.stop(); };
  }, [focusNodeId, nodesById, childrenByParent]);

  function hit(e: React.MouseEvent<HTMLCanvasElement>): SimNode | null {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (const n of nodesRef.current) {
      const r = RADIUS[n.tier] + 3;
      const dx = (n.x ?? 0) - x;
      const dy = (n.y ?? 0) - y;
      if (dx * dx + dy * dy < r * r) return n;
    }
    return null;
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const n = hit(e);
    if (n) selectNode(n.id);
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const n = hit(e);
    if (!n) return;
    if (n.tier === "focus") {
      focusParent();
    } else if ((childrenByParent.get(n.id)?.length ?? 0) > 0) {
      setFocusNode(n.id);
    }
  }

  const hasChildren = focusNodeId ? (childrenByParent.get(focusNodeId)?.length ?? 0) > 0 : false;

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} onClick={handleClick} onDoubleClick={handleDoubleClick} />
      {!hasChildren && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)" }}>
          This node has no children to display.
        </div>
      )}
      <div style={{ position: "absolute", top: 12, left: 12, fontSize: 11, color: "var(--text-dim)" }}>
        Double-click a node to zoom in · double-click the centre to go up
      </div>
    </div>
  );
}
