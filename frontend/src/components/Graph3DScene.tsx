import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Edges, Grid, Html, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useCallback, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ExplorerNode } from "../state/store";
import { useExplorerStore } from "../state/store";
import { ARCHETYPE_GLYPH, CORE_Y, PALETTE, archetypeOf, buildAccentMap, levelOf, sizeOf } from "../scene/grammar";
import { layeredLayout, radialLayout, type Placed, type SceneLayout, type Vec3 } from "../scene/layout";
import { SemanticEntity, type VisualState } from "../scene/forms/SemanticEntity";
import { PHYSICAL_EMBLEM, PhysicalArtifact } from "../scene/forms/PhysicalArtifacts";
import { Links } from "../scene/Links";
import { LayerPlanes } from "../scene/LayerPlanes";
import { SystemCard } from "../scene/hud/SystemCard";
import { FlowPanel, HudToolbar, Legend, LevelIndicator, Minimap, Timeline } from "../scene/hud/Hud";
import { commitsNear, semanticHistory, visibleFlow, type NodeHistory } from "../scene/derive";
import "../scene/scene.css";

/**
 * The 3D map. Not a graph of files but the software system the code creates:
 * entities shaped by what they are, stacked by architecture layer, joined by
 * weighted directional dependencies, with flows, health and time layered on
 * top. 3D carries the spatial relationships; the flat HUD carries meaning.
 */

const EXPLODE_MS = 650;
const DENSE = 40;

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

interface SceneModel {
  semantic: boolean;
  focus: ExplorerNode | null;
  layout: SceneLayout;
  positions: Map<string, Vec3>;
  accents: Map<string, string>;
  /** Ids to keep bright when a flow / highlight is active (null = everything). */
  litIds: Set<string> | null;
  flowOrder: string[];
  flowKeys: Set<string>;
  history: Map<string, NodeHistory>;
  /** Max commits-near-cursor among visible nodes (normalises the activity glow). */
  maxActivity: number;
  timeCursor: number | null;
  /** Moment the activity glow is measured at: the cursor, else the latest commit. */
  activityAt: number | null;
  chainOf: (id: string) => string[];
}

/** Builds everything the scene needs from the store in one memoised pass. */
function useSceneModel(): SceneModel {
  const layer = useExplorerStore((s) => s.layer);
  const nodes = useExplorerStore((s) => s.nodes);
  const nodesById = useExplorerStore((s) => s.nodesById);
  const childrenByParent = useExplorerStore((s) => s.childrenByParent);
  const focusNodeId = useExplorerStore((s) => s.focusNodeId);
  const links = useExplorerStore((s) => s.links);
  const highlight = useExplorerStore((s) => s.highlight);
  const flow = useExplorerStore((s) => s.flow);
  const historyResult = useExplorerStore((s) => s.history);
  const timeCursor = useExplorerStore((s) => s.timeCursor);

  const semantic = layer === "semantic";
  const focus = focusNodeId ? nodesById.get(focusNodeId) ?? null : null;
  const children = useMemo(() => (focusNodeId ? childrenByParent.get(focusNodeId) ?? [] : []), [focusNodeId, childrenByParent]);

  const chainOf = useCallback(
    (id: string) => {
      const out: string[] = [];
      let cur = nodesById.get(id);
      while (cur) {
        out.push(cur.id);
        cur = cur.parentId ? nodesById.get(cur.parentId) : undefined;
      }
      return out;
    },
    [nodesById]
  );

  const layout = useMemo<SceneLayout>(() => {
    if (!semantic) return radialLayout(children);
    // Context anchors: other top-level domains / external systems the visible nodes depend on.
    const visible = new Set(children.map((c) => c.id));
    const focusChain = new Set(focusNodeId ? chainOf(focusNodeId) : []);
    const anchorIds = new Set<string>();
    if (focus && focus.type !== "System") {
      for (const l of links) {
        if (l.scope !== "context") continue;
        if (visible.has(l.from) && !visible.has(l.to) && !focusChain.has(l.to)) anchorIds.add(l.to);
        if (visible.has(l.to) && !visible.has(l.from) && !focusChain.has(l.from)) anchorIds.add(l.from);
      }
    }
    const anchors = [...anchorIds].map((id) => nodesById.get(id)).filter((n): n is ExplorerNode => Boolean(n));
    return layeredLayout(children, links, anchors);
  }, [semantic, children, links, focus, focusNodeId, nodesById, chainOf]);

  const positions = useMemo(() => {
    const m = new Map<string, Vec3>();
    for (const p of [...layout.placed, ...layout.anchors]) m.set(p.node.id, p.position);
    if (focus?.type === "System") m.set(focus.id, [0, CORE_Y, 0]);
    return m;
  }, [layout, focus]);

  const accents = useMemo(() => buildAccentMap(nodes, nodesById), [nodes, nodesById]);

  const visibleSet = useMemo(() => new Set(positions.keys()), [positions]);
  const vflow = useMemo(() => visibleFlow(flow, visibleSet, chainOf), [flow, visibleSet, chainOf]);

  const history = useMemo(() => semanticHistory(nodes, historyResult), [nodes, historyResult]);
  const activityAt = timeCursor ?? (historyResult?.range ? Date.parse(historyResult.range.end) : null);
  const maxActivity = useMemo(() => {
    const t = activityAt;
    if (t === null) return 0;
    let max = 0;
    for (const id of visibleSet) {
      const h = history.get(id);
      if (h) max = Math.max(max, commitsNear(h, t));
    }
    return max;
  }, [history, visibleSet, activityAt]);

  const litIds = useMemo(() => {
    if (flow) return new Set(vflow.order);
    if (highlight) return new Set(highlight.ids);
    return null;
  }, [flow, vflow, highlight]);

  return { semantic, focus, layout, positions, accents, litIds, flowOrder: vflow.order, flowKeys: vflow.keys, history, maxActivity, timeCursor, activityAt, chainOf };
}

// ---- Node ------------------------------------------------------------------------

interface NodeProps {
  placed: Placed;
  model: SceneModel;
  dense: boolean;
  anchor?: boolean;
  origin: Vec3;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

function SceneNode({ placed, model, dense, anchor = false, origin, hoveredId, onHover }: NodeProps) {
  const { node, position, size } = placed;
  const selectedNodeId = useExplorerStore((s) => s.selectedNodeId);
  const selectNode = useExplorerStore((s) => s.selectNode);
  const setFocusNode = useExplorerStore((s) => s.setFocusNode);
  const setViewMode = useExplorerStore((s) => s.setViewMode);
  const childrenByParent = useExplorerStore((s) => s.childrenByParent);
  const focusChangedAt = useExplorerStore((s) => s.focusChangedAt);
  const overlay = useExplorerStore((s) => s.overlay);
  const hasChildren = (childrenByParent.get(node.id)?.length ?? 0) > 0;
  const selected = selectedNodeId === node.id;
  const hovered = hoveredId === node.id;
  const group = useRef<THREE.Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const { camera } = useThree();

  // Time: a node that didn't exist yet at the cursor is a ghost; activity = commits around the cursor.
  const hist = model.history.get(node.id);
  const notYet = model.timeCursor !== null && hist ? hist.firstSeen > model.timeCursor : false;
  const activity = hist && model.activityAt !== null && model.maxActivity > 0 ? commitsNear(hist, model.activityAt) / model.maxActivity : 0;

  const flowIndex = model.flowOrder.indexOf(node.id);
  const visual: VisualState = {
    selected,
    hovered,
    dimmed: model.litIds !== null && !model.litIds.has(node.id),
    pulse: 0,
    activity,
    ghost: anchor || notYet,
  };

  useFrame(({ clock }) => {
    if (!group.current) return;
    // Explode: children fly out from where their parent was; then a gentle idle float.
    const p = ease((performance.now() - focusChangedAt) / EXPLODE_MS);
    const float = dense ? 0 : Math.sin(clock.elapsedTime * 0.6 + position[0] * 0.3 + position[2] * 0.2) * 0.06;
    group.current.position.set(
      origin[0] + (position[0] - origin[0]) * p,
      origin[1] + (position[1] - origin[1]) * p + float,
      origin[2] + (position[2] - origin[2]) * p
    );
    group.current.scale.setScalar(0.25 + 0.75 * p);
    // Labels fade with distance so only what's near (or relevant) speaks.
    if (label.current) {
      const d = camera.position.distanceTo(group.current.position);
      const relevant = selected || hovered || flowIndex >= 0 || (model.litIds?.has(node.id) ?? false);
      label.current.style.opacity = relevant ? "1" : dense ? "0" : String(Math.max(0, Math.min(1, (75 - d) / 25)));
    }
  });

  function onClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    selectNode(node.id);
  }
  function onDoubleClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    if (anchor) { selectNode(node.id); return; }
    if (hasChildren) setFocusNode(node.id);
    else if (node.filePath) { selectNode(node.id); setViewMode("source"); }
  }

  const a = archetypeOf(node);
  const glyph = model.semantic ? ARCHETYPE_GLYPH[a] : PHYSICAL_EMBLEM[node.type];
  const tag = model.semantic
    ? node.type === "Concept" && node.kind && node.kind !== "Area" ? node.kind : node.type === "External" ? node.kind : node.type === "Group" ? node.kind : null
    : null;

  return (
    <group
      ref={group}
      position={origin}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerOver={(e) => { e.stopPropagation(); onHover(node.id); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { onHover(null); document.body.style.cursor = "auto"; }}
    >
      {model.semantic ? (
        <FlowPulse index={flowIndex} total={model.flowOrder.length}>
          {(pulse) => (
            <SemanticEntity
              node={node}
              size={size}
              accent={model.accents.get(node.id) ?? PALETTE.cyan}
              visual={{ ...visual, pulse }}
              childCount={childrenByParent.get(node.id)?.length ?? 0}
              health={overlay === "health" && !anchor}
              animate={!dense}
            />
          )}
        </FlowPulse>
      ) : (
        <PhysicalArtifact node={node} selected={selected} hovered={hovered} />
      )}
      <Html position={[0, size * 1.25 + 0.5, 0]} center distanceFactor={26} style={{ pointerEvents: "none" }}>
        <div ref={label} className={`node-label ${selected ? "selected" : ""} ${anchor ? "anchor" : ""} ${visual.dimmed ? "dimmed" : ""}`}>
          {glyph && <span className="emblem">{glyph}</span>}
          {tag && <span className="kind-tag">{tag}</span>}
          <span className="name">{node.name}</span>
          {hasChildren && !anchor && <span className="chev">›</span>}
          {anchor && <span className="chev">↗</span>}
        </div>
      </Html>
    </group>
  );
}

/** Pulses flow nodes in sequence: a wave travels along the path, step by step. */
function FlowPulse({ index, total, children }: { index: number; total: number; children: (pulse: number) => JSX.Element }) {
  const [pulse, setPulse] = useState(0);
  const last = useRef(0);
  useFrame(({ clock }) => {
    if (index < 0 || total === 0) {
      if (last.current !== 0) { last.current = 0; setPulse(0); }
      return;
    }
    const cycle = (clock.elapsedTime * 1.4) % (total + 2);
    const d = Math.abs(cycle - index);
    const v = d < 1 ? 1 - d * 0.6 : 0.35; // every node on the path stays lit; the wave brightens it
    if (Math.abs(v - last.current) > 0.05) { last.current = v; setPulse(v); }
  });
  return children(pulse);
}

// ---- Focus: system core or domain zone ----------------------------------------

function FocusMarker({ model, hoveredId, onHover }: { model: SceneModel; hoveredId: string | null; onHover: (id: string | null) => void }) {
  const focusParent = useExplorerStore((s) => s.focusParent);
  const selectNode = useExplorerStore((s) => s.selectNode);
  const selectedNodeId = useExplorerStore((s) => s.selectedNodeId);
  const focus = model.focus;
  if (!focus || !model.semantic) return null;

  if (focus.type === "System") {
    // The system's semantic core: the centre everything is organised around.
    return (
      <group
        position={[0, CORE_Y, 0]}
        onClick={(e) => { e.stopPropagation(); selectNode(focus.id); }}
        onPointerOver={(e) => { e.stopPropagation(); onHover(focus.id); }}
        onPointerOut={() => onHover(null)}
      >
        <SemanticEntity
          node={focus}
          size={sizeOf(focus)}
          accent={PALETTE.white}
          visual={{ selected: selectedNodeId === focus.id, hovered: hoveredId === focus.id, dimmed: false, pulse: 0, activity: 0, ghost: false }}
          childCount={0}
          health={false}
          animate
        />
        <Html position={[0, sizeOf(focus) * 1.9, 0]} center distanceFactor={26} style={{ pointerEvents: "none" }}>
          <div className="node-label center"><span className="emblem">◉</span><span className="name">{focus.name}</span></div>
        </Html>
      </group>
    );
  }

  // Inside a domain/component: it becomes the zone that contains everything you see.
  const half = model.layout.radius + 1.5;
  const top = model.layout.top + 2.2;
  const bottom = model.layout.bottom - 1.2;
  const accent = model.accents.get(focus.id) ?? PALETTE.cyan;
  return (
    <group>
      <mesh position={[0, (top + bottom) / 2, 0]} raycast={() => null}>
        <boxGeometry args={[half * 2, top - bottom, half * 2]} />
        <meshBasicMaterial color={accent} transparent opacity={0.015} depthWrite={false} side={THREE.BackSide} />
        <Edges color={accent} transparent opacity={0.22} />
      </mesh>
      <Html position={[0, top + 0.4, 0]} center distanceFactor={30}>
        <div className="node-label center zone" onDoubleClick={() => focusParent()} title="Double-click to go up a level">
          <span className="emblem">{ARCHETYPE_GLYPH[archetypeOf(focus)]}</span>
          <span className="name">{focus.name}</span>
          <span className="chev up">↑</span>
        </div>
      </Html>
    </group>
  );
}

// ---- Camera ----------------------------------------------------------------------

/** Eases to a 3/4 view of the layer stack whenever the focus changes (never mid-orbit). */
function CameraRig({ layout, focusKey }: { layout: SceneLayout; focusKey: string | null }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const anim = useRef<{ key: string | null; start: number; fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3 } | null>(null);

  useFrame(() => {
    if (!anim.current || anim.current.key !== focusKey) {
      const midY = (layout.top + layout.bottom) / 2;
      const height = layout.top - layout.bottom;
      // Fit both the plan radius and the layer stack height in a 45° field of view.
      const dist = Math.max(layout.radius * 1.35, height * 1.15) + 8;
      anim.current = {
        key: focusKey,
        start: performance.now(),
        fromPos: camera.position.clone(),
        fromTarget: controls?.target.clone() ?? new THREE.Vector3(),
        toPos: new THREE.Vector3(dist * 0.62, midY + dist * 0.42, dist * 0.62),
        toTarget: new THREE.Vector3(0, midY, 0),
      };
    }
    const a = anim.current;
    const t = (performance.now() - a.start) / 800;
    if (t > 1.05) return;
    const p = ease(t);
    camera.position.lerpVectors(a.fromPos, a.toPos, p);
    if (controls) {
      controls.target.lerpVectors(a.fromTarget, a.toTarget, p);
      controls.update();
    } else camera.lookAt(a.toTarget);
  });
  return null;
}

// ---- Scene -----------------------------------------------------------------------

function SceneContent({ model }: { model: SceneModel }) {
  const selectNode = useExplorerStore((s) => s.selectNode);
  const selectedNodeId = useExplorerStore((s) => s.selectedNodeId);
  const nodesById = useExplorerStore((s) => s.nodesById);
  const links = useExplorerStore((s) => s.links);
  const edges = useExplorerStore((s) => s.edges);
  const focusFromId = useExplorerStore((s) => s.focusFromId);
  const focusNodeId = useExplorerStore((s) => s.focusNodeId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { layout } = model;
  const dense = layout.placed.length > DENSE;
  const maxDist = layout.radius * 4 + (layout.top - layout.bottom) * 2 + 40;

  // Explode origin: going down, children burst from the centre; going up, from the node we came out of.
  const origin = useMemo<Vec3>(() => {
    const from = focusFromId ? model.positions.get(focusFromId) : undefined;
    if (from) return from;
    return model.semantic ? [0, (layout.top + layout.bottom) / 2, 0] : [0, 0, 0];
  }, [focusFromId, model.positions, model.semantic, layout.top, layout.bottom]);

  const focusIds = useMemo(() => new Set([selectedNodeId, hoveredId].filter((x): x is string => Boolean(x))), [selectedNodeId, hoveredId]);
  const selectedPlaced = [...layout.placed, ...layout.anchors].find((p) => p.node.id === selectedNodeId);
  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) : undefined;
  const cardPos: Vec3 | undefined = selectedPlaced?.position ?? (selectedNode && selectedNode.id === model.focus?.id && model.focus?.type === "System" ? [0, CORE_Y, 0] : undefined);

  return (
    <>
      <CameraRig layout={layout} focusKey={focusNodeId} />
      <ambientLight intensity={0.35} />
      <hemisphereLight args={["#bcd3ea", "#05070b", 0.45]} />
      <directionalLight position={[15, 25, 10]} intensity={0.55} />

      <Grid
        args={[120, 120]}
        cellSize={1}
        cellColor={PALETTE.grid}
        sectionSize={6}
        sectionColor={PALETTE.gridSection}
        fadeDistance={70}
        fadeStrength={1.6}
        infiniteGrid
        position={[0, layout.bottom - 2.2, 0]}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, layout.bottom - 2.21, 0]} onClick={() => selectNode(null)}>
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {model.semantic && layout.mode === "layered" && <LayerPlanes layers={layout.layers} radius={layout.radius} spine={model.focus?.type === "System"} />}
      <FocusMarker model={model} hoveredId={hoveredId} onHover={setHoveredId} />
      <Links
        positions={model.positions}
        nodesById={nodesById}
        accents={model.accents}
        links={model.semantic ? links : []}
        edges={model.semantic ? [] : edges}
        flowKeys={model.flowKeys}
        focusIds={focusIds}
        litIds={model.litIds}
      />
      {layout.placed.map((p) => (
        <SceneNode key={p.node.id} placed={p} model={model} dense={dense} origin={origin} hoveredId={hoveredId} onHover={setHoveredId} />
      ))}
      {layout.anchors.map((p) => (
        <SceneNode key={`anchor-${p.node.id}`} placed={p} model={model} dense={dense} anchor origin={p.position} hoveredId={hoveredId} onHover={setHoveredId} />
      ))}
      {selectedNode && cardPos && (
        <SystemCard node={selectedNode} position={cardPos} offset={(selectedPlaced?.size ?? 1.2) * 1.6 + 0.6} history={model.history.get(selectedNode.id) ?? null} chainOf={model.chainOf} />
      )}
      <OrbitControls enablePan enableDamping dampingFactor={0.12} minDistance={2.5} maxDistance={maxDist} makeDefault />
    </>
  );
}

export function Graph3DScene() {
  const model = useSceneModel();
  const [flowsOpen, setFlowsOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const empty = model.layout.placed.length === 0;

  return (
    <div className="scene-root">
      <Canvas dpr={[1, 2]} camera={{ fov: 45, position: [24, 16, 24] }} onPointerMissed={() => useExplorerStore.getState().selectNode(null)}>
        <color attach="background" args={[PALETTE.background]} />
        <fog attach="fog" args={[PALETTE.fog, 60, 170]} />
        <SceneContent model={model} />
        {/* Very low bloom: only the brightest cores/frames (toneMapped=false) pick up a luminous edge. */}
        <EffectComposer multisampling={4}>
          <Bloom intensity={0.45} luminanceThreshold={0.62} luminanceSmoothing={0.2} mipmapBlur />
        </EffectComposer>
      </Canvas>

      {model.semantic && <LevelIndicator level={levelOf(model.focus)} />}
      {model.semantic && (
        <HudToolbar flowsOpen={flowsOpen} onToggleFlows={() => setFlowsOpen((v) => !v)} timelineOpen={timelineOpen} onToggleTimeline={() => setTimelineOpen((v) => !v)} />
      )}
      {model.semantic && flowsOpen && <FlowPanel onClose={() => setFlowsOpen(false)} />}
      {model.semantic && timelineOpen && <Timeline />}
      <Minimap layout={model.layout} />
      <Legend semantic={model.semantic} />
      {empty && <div className="scene-empty">This node has no children to display.</div>}
      <div className="scene-hint">Double-click to explode · click for details · scroll to zoom · drag to orbit</div>
    </div>
  );
}
