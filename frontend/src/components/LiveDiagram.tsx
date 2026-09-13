import { forceCenter, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from "d3-force";
import { useEffect, useRef } from "react";
import { useExplorerStore } from "../state/store";

interface SimNode extends SimulationNodeDatum { id: string; name: string; type: string; }
export function LiveDiagram({ edgeType, nodeType = "all" }: { edgeType: "Imports" | "Calls" | "all"; nodeType?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodes = useExplorerStore((s) => s.nodes);
  const edges = useExplorerStore((s) => s.edges);
  const selectNode = useExplorerStore((s) => s.selectNode);
  const positions = useRef<SimNode[]>([]);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const visible = nodes.filter((n) => ["Folder", "File", "Class", "Interface", "Function"].includes(n.type) && (nodeType === "all" || n.type === nodeType)).slice(0, 180);
    const ids = new Set(visible.map((n) => n.id));
    const simNodes: SimNode[] = visible.map((n) => ({ id: n.id, name: n.name, type: n.type }));
    const links = edges.filter((e) => ids.has(e.fromNodeId) && ids.has(e.toNodeId) && (edgeType === "all" || e.type === edgeType)).map((e) => ({ source: e.fromNodeId, target: e.toNodeId, type: e.type }));
    positions.current = simNodes;
    const width = canvas.clientWidth, height = canvas.clientHeight; canvas.width = width * devicePixelRatio; canvas.height = height * devicePixelRatio;
    const ctx = canvas.getContext("2d")!; ctx.scale(devicePixelRatio, devicePixelRatio);
    const simulation = forceSimulation(simNodes).force("charge", forceManyBody().strength(-120)).force("center", forceCenter(width / 2, height / 2)).force("link", forceLink(links as any).id((d: any) => d.id).distance(75));
    function draw() { ctx.clearRect(0, 0, width, height); for (const l of links as any[]) { const s=l.source as SimNode,t=l.target as SimNode; if(typeof s!=="object"||typeof t!=="object")continue; ctx.strokeStyle=l.type==="Imports"?"#58a6ff":"#f0883e"; ctx.globalAlpha=.45; ctx.beginPath();ctx.moveTo(s.x??0,s.y??0);ctx.lineTo(t.x??0,t.y??0);ctx.stroke(); } ctx.globalAlpha=1; for(const n of simNodes){ctx.fillStyle=n.type==="Function"?"#f0883e":n.type==="File"?"#3fb950":"#bc8cff";ctx.beginPath();ctx.arc(n.x??0,n.y??0,7,0,Math.PI*2);ctx.fill();ctx.fillStyle="#e6edf3";ctx.font="10px sans-serif";ctx.fillText(n.name,n.x!+10,n.y!+3);}}
    simulation.on("tick", draw); return () => { simulation.stop(); };
  }, [nodes, edges, edgeType, nodeType]);
  function click(e: React.MouseEvent<HTMLCanvasElement>) { const r=canvasRef.current!.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top; const hit=positions.current.find((n)=>((n.x??0)-x)**2+((n.y??0)-y)**2<13**2); if(hit) selectNode(hit.id); }
  return <canvas ref={canvasRef} onClick={click} style={{width:"100%",height:"320px",display:"block",background:"rgba(0,0,0,.15)",borderRadius:8}} />;
}
