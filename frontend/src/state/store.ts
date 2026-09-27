import { create } from "zustand";
import type { Archetype, EntryPoint, FlowResult, GraphEdge, GraphNode, HistoryResult, NodeMetrics, SemanticLink, SemanticNode, SemanticTree } from "../api/types";

export type ViewMode = "3d" | "2d" | "source";
export type Layer = "semantic" | "files";
export type Overlay = "none" | "health";

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
  // Architecture pass extras (semantic layer only):
  archetype?: Archetype;
  layerArchetype?: Archetype;
  layer?: number | null;
  metrics?: NodeMetrics;
  architecturalKind?: Archetype | null;
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
    archetype: n.archetype,
    layerArchetype: n.layerArchetype,
    layer: n.layer,
    metrics: n.metrics,
    architecturalKind: n.architecturalKind,
  };
}

interface LayerData {
  nodes: ExplorerNode[];
  edges: GraphEdge[];
  /** Aggregated semantic dependencies (Map layer only). */
  links: SemanticLink[];
  entrypoints: EntryPoint[];
  rootId: string | null;
}

function semanticLayerOf(tree: SemanticTree | null): LayerData {
  const nodes = tree ? tree.nodes.map(fromSemanticNode) : [];
  return { nodes, edges: [], links: tree?.links ?? [], entrypoints: tree?.entrypoints ?? [], rootId: rootOf(nodes) };
}

interface ExplorerState {
  repoId: string | null;
  repoName: string | null;
  layer: Layer;
  aiEnriched: boolean;

  // Active-layer views (kept name-compatible with existing components):
  nodes: ExplorerNode[];
  edges: GraphEdge[];
  links: SemanticLink[];
  entrypoints: EntryPoint[];
  nodesById: Map<string, ExplorerNode>;
  childrenByParent: Map<string | null, ExplorerNode[]>;
  focusNodeId: string | null;
  selectedNodeId: string | null;
  breadcrumb: ExplorerNode[];

  viewMode: ViewMode;

  // 3D map interaction state
  /** Where the last focus change came from (for the explode / collapse animation). */
  focusFromId: string | null;
  focusChangedAt: number;
  /** Nodes lit up by "Why?" / Trace (everything else dims). */
  highlight: { ids: string[]; label: string } | null;
  flow: FlowResult | null;
  overlay: Overlay;
  history: HistoryResult | null;
  /** Timeline position (ms since epoch); null = present day. */
  timeCursor: number | null;

  // internal per-layer storage
  _layers: Record<Layer, LayerData>;

  loadRepo: (
    repoId: string,
    repoName: string,
    physical: { nodes: GraphNode[]; edges: GraphEdge[] },
    semantic: SemanticTree | null
  ) => void;
  setSemantic: (semantic: SemanticTree) => void;
  setLayer: (layer: Layer) => void;
  setFocusNode: (nodeId: string) => void;
  focusParent: () => void;
  selectNode: (nodeId: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setHighlight: (highlight: { ids: string[]; label: string } | null) => void;
  setFlow: (flow: FlowResult | null) => void;
  setOverlay: (overlay: Overlay) => void;
  setHistory: (history: HistoryResult | null) => void;
  setTimeCursor: (t: number | null) => void;
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
    links: layerData.links,
    entrypoints: layerData.entrypoints,
    nodesById,
    childrenByParent,
    focusNodeId,
    breadcrumb: computeBreadcrumb(nodesById, focusNodeId),
  };
}

const emptyLayer: LayerData = { nodes: [], edges: [], links: [], entrypoints: [], rootId: null };

const clearedInteraction = { highlight: null, flow: null, focusFromId: null, focusChangedAt: 0 };

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  repoId: null,
  repoName: null,
  layer: "semantic",
  aiEnriched: false,
  nodes: [],
  edges: [],
  links: [],
  entrypoints: [],
  nodesById: new Map(),
  childrenByParent: new Map(),
  focusNodeId: null,
  selectedNodeId: null,
  breadcrumb: [],
  viewMode: "3d",
  focusFromId: null,
  focusChangedAt: 0,
  highlight: null,
  flow: null,
  overlay: "none",
  history: null,
  timeCursor: null,
  _layers: { semantic: emptyLayer, files: emptyLayer },

  loadRepo: (repoId, repoName, physical, semantic) => {
    const physicalNodes = physical.nodes.map(fromGraphNode);
    const physicalLayer: LayerData = { nodes: physicalNodes, edges: physical.edges, links: [], entrypoints: [], rootId: rootOf(physicalNodes) };
    const semanticLayer = semanticLayerOf(semantic);

    const layer: Layer = semanticLayer.nodes.length > 0 ? "semantic" : "files";
    const active = activate(layer === "semantic" ? semanticLayer : physicalLayer);

    set({
      repoId,
      repoName,
      layer,
      aiEnriched: semantic?.aiEnriched ?? false,
      _layers: { semantic: semanticLayer, files: physicalLayer },
      selectedNodeId: null,
      history: null,
      timeCursor: null,
      ...clearedInteraction,
      ...active,
    });
  },

  setSemantic: (semantic) => {
    const semanticLayer = semanticLayerOf(semantic);
    const layers = { ...get()._layers, semantic: semanticLayer };
    const patch: Partial<ExplorerState> = { _layers: layers, aiEnriched: semantic.aiEnriched };
    if (get().layer === "semantic") Object.assign(patch, activate(semanticLayer), { selectedNodeId: null }, clearedInteraction);
    set(patch);
  },

  setLayer: (layer) => {
    const layerData = get()._layers[layer];
    set({ layer, selectedNodeId: null, ...clearedInteraction, ...activate(layerData) });
  },

  setFocusNode: (nodeId) => {
    const { nodesById } = get();
    if (!nodesById.has(nodeId)) return;
    set({ focusNodeId: nodeId, breadcrumb: computeBreadcrumb(nodesById, nodeId), focusFromId: get().focusNodeId, focusChangedAt: performance.now() });
  },

  focusParent: () => {
    const { focusNodeId, nodesById } = get();
    if (!focusNodeId) return;
    const current = nodesById.get(focusNodeId);
    if (!current || !current.parentId) return;
    set({ focusNodeId: current.parentId, breadcrumb: computeBreadcrumb(nodesById, current.parentId), focusFromId: focusNodeId, focusChangedAt: performance.now() });
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setHighlight: (highlight) => set({ highlight }),
  setFlow: (flow) => set({ flow, highlight: null }),
  setOverlay: (overlay) => set({ overlay }),
  setHistory: (history) => set({ history }),
  setTimeCursor: (timeCursor) => set({ timeCursor }),

  reset: () =>
    set({
      repoId: null,
      repoName: null,
      layer: "semantic",
      aiEnriched: false,
      nodes: [],
      edges: [],
      links: [],
      entrypoints: [],
      nodesById: new Map(),
      childrenByParent: new Map(),
      focusNodeId: null,
      selectedNodeId: null,
      breadcrumb: [],
      history: null,
      timeCursor: null,
      overlay: "none",
      ...clearedInteraction,
      _layers: { semantic: emptyLayer, files: emptyLayer },
    }),
}));
