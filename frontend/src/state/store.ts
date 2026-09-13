import { create } from "zustand";
import type { GraphEdge, GraphNode, SemanticNode } from "../api/types";

export type ViewMode = "3d" | "2d" | "source";
export type Layer = "semantic" | "files";

/** Unified node the explorer UI renders, mapped from either graph layer. */
export interface ExplorerNode {
  id: string;
  type: string;
  name: string;
  parentId: string | null;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  /** Physical graph node id used for source/explain (semantic leaves carry this). */
  physicalNodeId: string | null;
  // Semantic-only extras:
  kind?: string;
  summary?: string;
  capability?: string | null;
  role?: string | null;
  confidence?: number;
  source?: string;
}

function fromGraphNode(n: GraphNode): ExplorerNode {
  return {
    id: n.id,
    type: n.type,
    name: n.name,
    parentId: n.parentId,
    filePath: n.filePath,
    startLine: n.startLine,
    endLine: n.endLine,
    language: n.language,
    physicalNodeId: n.id,
  };
}

function fromSemanticNode(n: SemanticNode): ExplorerNode {
  return {
    id: n.id,
    type: n.type,
    name: n.name,
    parentId: n.parentId,
    filePath: n.filePath,
    startLine: n.startLine,
    endLine: n.endLine,
    language: n.language,
    physicalNodeId: n.physicalNodeId,
    kind: n.kind,
    summary: n.summary,
    capability: n.capability,
    role: n.role,
    confidence: n.confidence,
    source: n.source,
  };
}

interface LayerData {
  nodes: ExplorerNode[];
  edges: GraphEdge[];
  rootId: string | null;
}

interface ExplorerState {
  repoId: string | null;
  repoName: string | null;
  layer: Layer;
  aiEnriched: boolean;

  // Active-layer views (kept name-compatible with existing components):
  nodes: ExplorerNode[];
  edges: GraphEdge[];
  nodesById: Map<string, ExplorerNode>;
  childrenByParent: Map<string | null, ExplorerNode[]>;
  focusNodeId: string | null;
  selectedNodeId: string | null;
  breadcrumb: ExplorerNode[];

  viewMode: ViewMode;

  // internal per-layer storage
  _layers: Record<Layer, LayerData>;

  loadRepo: (
    repoId: string,
    repoName: string,
    physical: { nodes: GraphNode[]; edges: GraphEdge[] },
    semantic: { nodes: SemanticNode[]; aiEnriched: boolean } | null
  ) => void;
  setSemantic: (semantic: { nodes: SemanticNode[]; aiEnriched: boolean }) => void;
  setLayer: (layer: Layer) => void;
  setFocusNode: (nodeId: string) => void;
  focusParent: () => void;
  selectNode: (nodeId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  reset: () => void;
}

function indexLayer(nodes: ExplorerNode[]) {
  const nodesById = new Map<string, ExplorerNode>();
  const childrenByParent = new Map<string | null, ExplorerNode[]>();
  for (const n of nodes) nodesById.set(n.id, n);
  for (const n of nodes) {
    const list = childrenByParent.get(n.parentId) ?? [];
    list.push(n);
    childrenByParent.set(n.parentId, list);
  }
  return { nodesById, childrenByParent };
}

function computeBreadcrumb(nodesById: Map<string, ExplorerNode>, nodeId: string | null): ExplorerNode[] {
  const path: ExplorerNode[] = [];
  let current = nodeId ? nodesById.get(nodeId) : undefined;
  while (current) {
    path.unshift(current);
    current = current.parentId ? nodesById.get(current.parentId) : undefined;
  }
  return path;
}

function rootOf(nodes: ExplorerNode[]): string | null {
  const root = nodes.find((n) => n.parentId === null);
  return root ? root.id : null;
}

function activate(layerData: LayerData) {
  const { nodesById, childrenByParent } = indexLayer(layerData.nodes);
  const focusNodeId = layerData.rootId;
  return {
    nodes: layerData.nodes,
    edges: layerData.edges,
    nodesById,
    childrenByParent,
    focusNodeId,
    breadcrumb: computeBreadcrumb(nodesById, focusNodeId),
  };
}

const emptyLayer: LayerData = { nodes: [], edges: [], rootId: null };

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  repoId: null,
  repoName: null,
  layer: "semantic",
  aiEnriched: false,
  nodes: [],
  edges: [],
  nodesById: new Map(),
  childrenByParent: new Map(),
  focusNodeId: null,
  selectedNodeId: null,
  breadcrumb: [],
  viewMode: "3d",
  _layers: { semantic: emptyLayer, files: emptyLayer },

  loadRepo: (repoId, repoName, physical, semantic) => {
    const physicalNodes = physical.nodes.map(fromGraphNode);
    const physicalLayer: LayerData = { nodes: physicalNodes, edges: physical.edges, rootId: rootOf(physicalNodes) };
    const semanticNodes = semantic ? semantic.nodes.map(fromSemanticNode) : [];
    const semanticLayer: LayerData = { nodes: semanticNodes, edges: [], rootId: rootOf(semanticNodes) };

    const layer: Layer = semanticNodes.length > 0 ? "semantic" : "files";
    const active = activate(layer === "semantic" ? semanticLayer : physicalLayer);

    set({
      repoId,
      repoName,
      layer,
      aiEnriched: semantic?.aiEnriched ?? false,
      _layers: { semantic: semanticLayer, files: physicalLayer },
      selectedNodeId: null,
      ...active,
    });
  },

  setSemantic: (semantic) => {
    const semanticNodes = semantic.nodes.map(fromSemanticNode);
    const semanticLayer: LayerData = { nodes: semanticNodes, edges: [], rootId: rootOf(semanticNodes) };
    const layers = { ...get()._layers, semantic: semanticLayer };
    const patch: Partial<ExplorerState> = { _layers: layers, aiEnriched: semantic.aiEnriched };
    if (get().layer === "semantic") Object.assign(patch, activate(semanticLayer), { selectedNodeId: null });
    set(patch);
  },

  setLayer: (layer) => {
    const layerData = get()._layers[layer];
    set({ layer, selectedNodeId: null, ...activate(layerData) });
  },

  setFocusNode: (nodeId) => {
    const { nodesById } = get();
    if (!nodesById.has(nodeId)) return;
    set({ focusNodeId: nodeId, breadcrumb: computeBreadcrumb(nodesById, nodeId) });
  },

  focusParent: () => {
    const { focusNodeId, nodesById } = get();
    if (!focusNodeId) return;
    const current = nodesById.get(focusNodeId);
    if (!current || !current.parentId) return;
    set({ focusNodeId: current.parentId, breadcrumb: computeBreadcrumb(nodesById, current.parentId) });
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setViewMode: (mode) => set({ viewMode: mode }),

  reset: () =>
    set({
      repoId: null,
      repoName: null,
      layer: "semantic",
      aiEnriched: false,
      nodes: [],
      edges: [],
      nodesById: new Map(),
      childrenByParent: new Map(),
      focusNodeId: null,
      selectedNodeId: null,
      breadcrumb: [],
      _layers: { semantic: emptyLayer, files: emptyLayer },
    }),
}));
