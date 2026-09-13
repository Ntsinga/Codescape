import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls, RoundedBox } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ExplorerNode } from "../state/store";
import { useExplorerStore } from "../state/store";

// ---- Type presentation ---------------------------------------------------

/** Base tint per node type (used for shapes + labels). */
const TYPE_TINT: Record<string, string> = {
  // Conceptual (Map) layer
  System: "#f0b429",
  Concept: "#58a6ff",
  Unit: "#3fb950",
  // Physical (Files) layer
  Repository: "#f0b429",
  Folder: "#5c93ff",
  File: "#3fb950",
  Class: "#d29922",
  Interface: "#bc8cff",
  Function: "#f0883e",
  ImportedModule: "#6e7681",
};

/** Distinct emblem drawn on the badge above each node (Concept/Group show their AI kind separately). */
const TYPE_EMBLEM: Record<string, string> = {
  System: "📦",
  Concept: "🧩",
  Repository: "📦",
  Folder: "📁",
  Class: "{ }",
  Interface: "<>",
  Function: "ƒ",
  ImportedModule: "⇢",
};

/** For File nodes, use the source language rather than a generic emblem. */
const LANGUAGE_BADGE: Record<string, { label: string; color: string }> = {
  typescript: { label: "TS", color: "#3178c6" },
  javascript: { label: "JS", color: "#f7df1e" },
  python: { label: "PY", color: "#3572A5" },
  csharp: { label: "C#", color: "#68217a" },
};

function fileBadge(node: ExplorerNode): { label: string; color: string } {
  if (node.language && LANGUAGE_BADGE[node.language]) return LANGUAGE_BADGE[node.language];
  const ext = node.filePath?.split(".").pop()?.toUpperCase() ?? "•";
  return { label: ext.length <= 4 ? ext : "•", color: "#4a5262" };
}

// ---- Layout --------------------------------------------------------------

interface LayoutNode {
  node: ExplorerNode;
  position: [number, number, number];
}

/**
 * Spreads children evenly around the parent using a Fibonacci-sphere distribution,
 * with the radius scaled to the child count so neighbours keep a roughly constant
 * gap (no overlap, no squeezing). Links radiate from the centre, reading as a
 * proper radial tree you orbit around. The sphere is flattened vertically so it
 * feels like a canopy rather than a ball.
 */
function layoutChildren(children: ExplorerNode[]): LayoutNode[] {
  const n = children.length;
  if (n === 0) return [];
  if (n === 1) return [{ node: children[0], position: [0, 0, 6] }];

  const spacing = 4.2; // desired gap between neighbouring nodes (fits labels)
  const radius = Math.max(6, (spacing * Math.sqrt(n)) / 2.4);
  const golden = Math.PI * (3 - Math.sqrt(5)); // ~2.399963 rad

  return children.map((node, i) => {
    const y = 1 - (i / (n - 1)) * 2; // 1 → -1
    const rAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * rAtY * radius;
    const z = Math.sin(theta) * rAtY * radius;
    return { node, position: [x, y * radius * 0.55, z] }; // flatten Y into a canopy
  });
}

/** Horizontal + vertical extent of a layout, for framing the camera. */
function layoutExtent(layout: LayoutNode[]): { radius: number; height: number } {
  if (layout.length === 0) return { radius: 4, height: 0 };
  const radius = Math.max(...layout.map((l) => Math.hypot(l.position[0], l.position[2])));
  const height = Math.max(...layout.map((l) => l.position[1]));
  return { radius, height };
}

// ---- Per-type 3D artifacts ----------------------------------------------

interface ArtifactProps {
  node: ExplorerNode;
  selected: boolean;
  hovered: boolean;
}

function RepositoryArtifact({ selected, hovered }: ArtifactProps) {
  const emissive = selected ? 0.9 : hovered ? 0.4 : 0.15;
  return (
    <group>
      <mesh castShadow>
        <cylinderGeometry args={[1.0, 1.1, 0.35, 24]} />
        <meshStandardMaterial color="#3b2b0a" metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.5, 0]} castShadow>
        <icosahedronGeometry args={[0.75, 0]} />
        <meshStandardMaterial color={TYPE_TINT.Repository} metalness={0.55} roughness={0.25} emissive={TYPE_TINT.Repository} emissiveIntensity={emissive} />
      </mesh>
    </group>
  );
}

function FolderArtifact({ selected, hovered }: ArtifactProps) {
  // Open-folder silhouette: back plate (tab) + front slab.
  const emissive = selected ? 0.6 : hovered ? 0.25 : 0;
  return (
    <group>
      <RoundedBox args={[1.35, 0.9, 0.15]} radius={0.06} smoothness={4} position={[0, 0.28, -0.05]}>
        <meshStandardMaterial color="#2b3a52" roughness={0.7} />
      </RoundedBox>
      <RoundedBox args={[0.7, 0.22, 0.15]} radius={0.05} smoothness={4} position={[-0.32, 0.72, -0.05]}>
        <meshStandardMaterial color="#2b3a52" roughness={0.7} />
      </RoundedBox>
      <RoundedBox args={[1.4, 0.85, 0.2]} radius={0.08} smoothness={4} position={[0, 0.15, 0.05]}>
        <meshStandardMaterial color={TYPE_TINT.Folder} roughness={0.55} metalness={0.15} emissive={TYPE_TINT.Folder} emissiveIntensity={emissive} />
      </RoundedBox>
    </group>
  );
}

function FileArtifact({ node, selected, hovered }: ArtifactProps) {
  const badge = fileBadge(node);
  const emissive = selected ? 0.7 : hovered ? 0.3 : 0;
  return (
    <group>
      <RoundedBox args={[0.95, 1.2, 0.09]} radius={0.05} smoothness={4}>
        <meshStandardMaterial color="#e6edf3" roughness={0.5} metalness={0.05} emissive="#58a6ff" emissiveIntensity={emissive * 0.4} />
      </RoundedBox>
      {/* Folded corner */}
      <mesh position={[0.36, 0.5, 0.055]}>
        <planeGeometry args={[0.22, 0.22]} />
        <meshBasicMaterial color="#c4cbd4" />
      </mesh>
      {/* Language color stripe */}
      <mesh position={[0, -0.42, 0.055]}>
        <planeGeometry args={[0.95, 0.28]} />
        <meshBasicMaterial color={badge.color} />
      </mesh>
      <Html position={[0, -0.42, 0.06]} center transform distanceFactor={5}>
        <div style={{ color: readableOn(badge.color), fontFamily: "monospace", fontWeight: 800, fontSize: 22, letterSpacing: 1 }}>
          {badge.label}
        </div>
      </Html>
    </group>
  );
}

function ClassArtifact({ selected, hovered }: ArtifactProps) {
  const emissive = selected ? 0.9 : hovered ? 0.4 : 0.1;
  return (
    <mesh castShadow rotation={[0, 0, Math.PI / 4]}>
      <octahedronGeometry args={[0.55, 0]} />
      <meshStandardMaterial color={TYPE_TINT.Class} metalness={0.45} roughness={0.3} emissive={TYPE_TINT.Class} emissiveIntensity={emissive} />
    </mesh>
  );
}

function InterfaceArtifact({ selected, hovered }: ArtifactProps) {
  // Hollow ring — "socket"
  const emissive = selected ? 0.9 : hovered ? 0.4 : 0.1;
  return (
    <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.45, 0.14, 16, 40]} />
      <meshStandardMaterial color={TYPE_TINT.Interface} metalness={0.4} roughness={0.3} emissive={TYPE_TINT.Interface} emissiveIntensity={emissive} />
    </mesh>
  );
}

function FunctionArtifact({ selected, hovered }: ArtifactProps) {
  const emissive = selected ? 0.9 : hovered ? 0.4 : 0.15;
  return (
    <mesh castShadow>
      <sphereGeometry args={[0.35, 24, 24]} />
      <meshStandardMaterial color={TYPE_TINT.Function} metalness={0.4} roughness={0.25} emissive={TYPE_TINT.Function} emissiveIntensity={emissive} />
    </mesh>
  );
}

function ImportedModuleArtifact({ selected, hovered }: ArtifactProps) {
  const emissive = selected ? 0.6 : hovered ? 0.3 : 0;
  return (
    <mesh castShadow rotation={[0, Math.PI / 4, 0]}>
      <boxGeometry args={[0.55, 0.55, 0.55]} />
      <meshStandardMaterial color={TYPE_TINT.ImportedModule} metalness={0.2} roughness={0.7} emissive={TYPE_TINT.ImportedModule} emissiveIntensity={emissive} wireframe />
    </mesh>
  );
}

function ConceptArtifact({ selected, hovered }: ArtifactProps) {
  // Soft rounded "module" cube — a capability container you enter.
  const emissive = selected ? 0.75 : hovered ? 0.4 : 0.18;
  return (
    <group>
      <RoundedBox args={[1.25, 1.25, 1.25]} radius={0.22} smoothness={5} castShadow>
        <meshStandardMaterial color={TYPE_TINT.Concept} metalness={0.5} roughness={0.28} emissive={TYPE_TINT.Concept} emissiveIntensity={emissive} />
      </RoundedBox>
      {/* faint glow shell so it reads as an enterable region */}
      <mesh scale={1.18}>
        <boxGeometry args={[1.25, 1.25, 1.25]} />
        <meshBasicMaterial color={TYPE_TINT.Concept} transparent opacity={hovered || selected ? 0.14 : 0.06} />
      </mesh>
    </group>
  );
}

function Artifact(props: ArtifactProps) {
  switch (props.node.type) {
    // Conceptual (Map) layer
    case "System": return <RepositoryArtifact {...props} />;
    case "Concept": return <ConceptArtifact {...props} />;
    case "Unit": return <FileArtifact {...props} />;
    // Physical (Files) layer
    case "Repository": return <RepositoryArtifact {...props} />;
    case "Folder": return <FolderArtifact {...props} />;
    case "File": return <FileArtifact {...props} />;
    case "Class": return <ClassArtifact {...props} />;
    case "Interface": return <InterfaceArtifact {...props} />;
    case "Function": return <FunctionArtifact {...props} />;
    case "ImportedModule": return <ImportedModuleArtifact {...props} />;
    default: return null;
  }
}

// ---- Node group -----------------------------------------------------------

function NodeGroup({ layoutNode, dense = false }: { layoutNode: LayoutNode; dense?: boolean }) {
  const { node, position } = layoutNode;
  const selectedNodeId = useExplorerStore((s) => s.selectedNodeId);
  const selectNode = useExplorerStore((s) => s.selectNode);
  const setFocusNode = useExplorerStore((s) => s.setFocusNode);
  const setViewMode = useExplorerStore((s) => s.setViewMode);
  const childrenByParent = useExplorerStore((s) => s.childrenByParent);
  const hasChildren = (childrenByParent.get(node.id)?.length ?? 0) > 0;
  const isSelected = selectedNodeId === node.id;
  const [hovered, setHovered] = useState(false);
  const groupRef = useRef<THREE.Group>(null);

  // Subtle idle float so the scene feels alive without being distracting.
  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;
    const seed = position[0] * 0.31 + position[2] * 0.17;
    groupRef.current.position.y = position[1] + Math.sin(t * 0.7 + seed) * 0.05;
  });

  function handleClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    selectNode(node.id);
  }
  function handleDoubleClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    if (hasChildren) {
      setFocusNode(node.id);
    } else if (node.filePath) {
      // Leaf (e.g. a Function): drill straight into its source.
      selectNode(node.id);
      setViewMode("source");
    }
  }

  // File/Unit carry their badge on the tile itself, so no text emblem.
  const emblem = node.type === "File" || node.type === "Unit" ? null : TYPE_EMBLEM[node.type];
  const kindTag =
    node.type === "Concept" && node.kind && node.kind !== "Area"
      ? node.kind
      : node.type === "Unit" && node.role && node.role !== "Core"
      ? node.role
      : null;

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = "auto"; }}
    >
      <Artifact node={node} selected={isSelected} hovered={hovered} />

      {/* Selection ring */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
          <ringGeometry args={[0.9, 1.05, 40]} />
          <meshBasicMaterial color="#58a6ff" transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Name label — hidden on dense levels unless hovered/selected, to stay readable and fast. */}
      {(!dense || hovered || isSelected) && (
        <Html distanceFactor={14} position={[0, 1.1, 0]} center>
          <div className={`node-label ${isSelected ? "selected" : ""}`}>
            {emblem && <span className="emblem">{emblem}</span>}
            {kindTag && <span className="kind-tag">{kindTag}</span>}
            <span className="name">{node.name}</span>
            {hasChildren && <span className="chev">›</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

// ---- Edges + rig ---------------------------------------------------------

function Edges({ layout }: { layout: LayoutNode[] }) {
  const edges = useExplorerStore((s) => s.edges);
  const byId = useMemo(() => new Map(layout.map((l) => [l.node.id, l])), [layout]);

  const lines = useMemo(() => {
    const visibleIds = new Set(layout.map((l) => l.node.id));
    return edges
      .filter((e) => e.type !== "Contains" && visibleIds.has(e.fromNodeId) && visibleIds.has(e.toNodeId))
      .map((e) => ({
        key: e.id,
        from: byId.get(e.fromNodeId)!.position,
        to: byId.get(e.toNodeId)!.position,
        color: e.type === "Imports" ? "#58a6ff" : "#f0883e",
        dashed: e.confidence === "framework-derived",
      }));
  }, [edges, layout, byId]);

  return (
    <>
      {lines.map((l) => (
        <Line key={l.key} points={[l.from, l.to]} color={l.color} lineWidth={1.4} dashed={l.dashed} transparent opacity={0.6} />
      ))}
    </>
  );
}

function CameraRig({ radius, height, focusKey }: { radius: number; height: number; focusKey: string | null }) {
  const { camera } = useThree();
  // Re-frame only when the focused node changes (not on every render), so the
  // user's own orbit/zoom isn't yanked back mid-interaction.
  useEffect(() => {
    const dist = radius * 1.6 + height * 0.6 + 6;
    camera.position.set(dist * 0.5, height * 0.5 + dist * 0.45, dist * 0.5);
    camera.lookAt(0, height * 0.4, 0);
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** The focused parent, rendered at the centre as the root of the visible tree. */
function CenterNode({ node }: { node: ExplorerNode }) {
  const focusParent = useExplorerStore((s) => s.focusParent);
  const selectNode = useExplorerStore((s) => s.selectNode);
  const selectedNodeId = useExplorerStore((s) => s.selectedNodeId);
  const [hovered, setHovered] = useState(false);
  const isSelected = selectedNodeId === node.id;
  const canGoUp = Boolean(node.parentId);
  const kindTag = node.type === "Concept" && node.kind && node.kind !== "Area" ? node.kind : null;

  return (
    <group
      onClick={(e) => { e.stopPropagation(); selectNode(node.id); }}
      onDoubleClick={(e) => { e.stopPropagation(); if (canGoUp) focusParent(); }}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = "auto"; }}
    >
      <Artifact node={node} selected={isSelected} hovered={hovered} />
      <Html distanceFactor={16} position={[0, 1.25, 0]} center>
        <div className={`node-label center ${isSelected ? "selected" : ""}`}>
          {kindTag && <span className="kind-tag">{kindTag}</span>}
          <span className="name">{node.name}</span>
          {canGoUp && <span className="chev up" title="Double-click to go up">↑</span>}
        </div>
      </Html>
    </group>
  );
}

/** Links from the centre (focus) node to each child — the trunk of the tree. */
function HierarchyLinks({ layout }: { layout: LayoutNode[] }) {
  return (
    <>
      {layout.map((l) => (
        <Line key={`trunk-${l.node.id}`} points={[[0, 0, 0], l.position]} color="#3d4b60" lineWidth={1.2} transparent opacity={0.45} />
      ))}
    </>
  );
}

/** A small connected fan of each child's own children, so depth is visible without drilling. */
function SubtreePreview({ layout }: { layout: LayoutNode[] }) {
  const childrenByParent = useExplorerStore((s) => s.childrenByParent);
  const { links, dots } = useMemo(() => {
    const links: Array<{ key: string; from: [number, number, number]; to: [number, number, number]; color: string }> = [];
    const dots: Array<{ key: string; pos: [number, number, number]; color: string }> = [];
    if (layout.length > 18) return { links, dots }; // avoid clutter on wide levels
    for (const l of layout) {
      const grand = childrenByParent.get(l.node.id) ?? [];
      const n = Math.min(grand.length, 6);
      if (n === 0) continue;
      const [cx, cy, cz] = l.position;
      const baseAngle = Math.atan2(cz, cx); // point the fan outward from centre
      const spread = 0.9;
      for (let i = 0; i < n; i++) {
        const ang = baseAngle + (i - (n - 1) / 2) * (spread / Math.max(n - 1, 1));
        const gx = cx + Math.cos(ang) * 1.25;
        const gz = cz + Math.sin(ang) * 1.25;
        const gy = cy + 0.15;
        const color = TYPE_TINT[grand[i].type] ?? "#8b949e";
        links.push({ key: `gl-${l.node.id}-${i}`, from: [cx, cy, cz], to: [gx, gy, gz], color });
        dots.push({ key: `gd-${l.node.id}-${i}`, pos: [gx, gy, gz], color });
      }
    }
    return { links, dots };
  }, [layout, childrenByParent]);

  return (
    <>
      {links.map((o) => (
        <Line key={o.key} points={[o.from, o.to]} color={o.color} lineWidth={1} transparent opacity={0.28} />
      ))}
      {dots.map((d) => (
        <mesh key={d.key} position={d.pos}>
          <sphereGeometry args={[0.11, 10, 10]} />
          <meshStandardMaterial color={d.color} emissive={d.color} emissiveIntensity={0.35} />
        </mesh>
      ))}
    </>
  );
}

function SceneContent() {
  const focusNodeId = useExplorerStore((s) => s.focusNodeId);
  const childrenByParent = useExplorerStore((s) => s.childrenByParent);
  const nodesById = useExplorerStore((s) => s.nodesById);
  const selectNode = useExplorerStore((s) => s.selectNode);

  const focusNode = focusNodeId ? nodesById.get(focusNodeId) ?? null : null;
  const children = focusNodeId ? childrenByParent.get(focusNodeId) ?? [] : [];
  const layout = useMemo(() => layoutChildren(children), [children]);
  const { radius, height } = layoutExtent(layout);
  const dense = layout.length > 40;
  const maxDist = radius * 3 + height * 2 + 30;

  return (
    <>
      <CameraRig radius={radius} height={height} focusKey={focusNodeId} />
      <hemisphereLight args={["#c9d6e6", "#0d1117", 0.55]} />
      <directionalLight position={[15, 20, 10]} intensity={0.75} castShadow />
      <pointLight position={[-12, 8, -12]} intensity={0.25} color="#58a6ff" />

      <Grid
        args={[80, 80]}
        cellSize={1}
        cellColor="#1c2431"
        sectionSize={5}
        sectionColor="#2a3441"
        fadeDistance={45}
        fadeStrength={1.4}
        infiniteGrid
        position={[0, -0.55, 0]}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.56, 0]} onClick={() => selectNode(null)}>
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial color="#0d1117" transparent opacity={0} />
      </mesh>

      {/* Interconnected tree: centre → children → grandchild preview */}
      <HierarchyLinks layout={layout} />
      <SubtreePreview layout={layout} />
      {focusNode && <CenterNode node={focusNode} />}
      <Edges layout={layout} />
      {layout.map((l) => (
        <NodeGroup key={l.node.id} layoutNode={l} dense={dense} />
      ))}
      <OrbitControls enablePan enableDamping dampingFactor={0.12} minDistance={2.5} maxDistance={maxDist} target={[0, height * 0.4, 0]} makeDefault />
    </>
  );
}

// ---- Minimap + shell ------------------------------------------------------

function Minimap() {
  const focusNodeId = useExplorerStore((s) => s.focusNodeId);
  const childrenByParent = useExplorerStore((s) => s.childrenByParent);
  const selectedNodeId = useExplorerStore((s) => s.selectedNodeId);
  const children = focusNodeId ? childrenByParent.get(focusNodeId) ?? [] : [];
  const layout = useMemo(() => layoutChildren(children), [children]);
  const maxR = layout.length > 0 ? Math.max(...layout.map((l) => Math.hypot(l.position[0], l.position[2]))) : 1;

  return (
    <div className="minimap">
      <svg width="100%" height="100%" viewBox="-60 -60 120 120">
        <circle cx={0} cy={0} r={2.5} fill="var(--accent)" />
        {layout.map((l) => {
          const x = (l.position[0] / maxR) * 50;
          const y = (l.position[2] / maxR) * 50;
          const isSelected = l.node.id === selectedNodeId;
          return <circle key={l.node.id} cx={x} cy={y} r={isSelected ? 3 : 2} fill={TYPE_TINT[l.node.type] ?? "#888"} />;
        })}
      </svg>
    </div>
  );
}

function Legend() {
  const layer = useExplorerStore((s) => s.layer);
  const items: Array<{ label: string; swatch: React.ReactNode }> =
    layer === "semantic"
      ? [
          { label: "Concept", swatch: <span className="swatch concept">🧩</span> },
          { label: "File", swatch: <span className="swatch file">TS</span> },
          { label: "Function", swatch: <span className="swatch function">ƒ</span> },
        ]
      : [
          { label: "Folder", swatch: <span className="swatch folder">📁</span> },
          { label: "File", swatch: <span className="swatch file">TS</span> },
          { label: "Class", swatch: <span className="swatch class">{"{ }"}</span> },
          { label: "Interface", swatch: <span className="swatch interface">{"<>"}</span> },
          { label: "Function", swatch: <span className="swatch function">ƒ</span> },
        ];
  return (
    <div className="legend">
      {items.map((it) => (
        <div key={it.label} className="legend-item">
          {it.swatch}
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Graph3DScene() {
  const focusNodeId = useExplorerStore((s) => s.focusNodeId);
  const childrenByParent = useExplorerStore((s) => s.childrenByParent);
  const hasChildren = focusNodeId ? (childrenByParent.get(focusNodeId)?.length ?? 0) > 0 : false;

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 50, position: [8, 6, 8] }}
        onPointerMissed={() => useExplorerStore.getState().selectNode(null)}
      >
        <color attach="background" args={[new THREE.Color("#0a0f18")]} />
        <fog attach="fog" args={["#0a0f18", 30, 90]} />
        <SceneContent />
      </Canvas>
      <Minimap />
      <Legend />
      {!hasChildren && (
        <div
          style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-dim)", pointerEvents: "none",
          }}
        >
          This node has no children to display.
        </div>
      )}
      <div style={{ position: "absolute", top: 12, left: 12, fontSize: 11, color: "var(--text-dim)" }}>
        Double-click a node to zoom in · scroll out to zoom out · click empty space to deselect
      </div>
    </div>
  );
}

// ---- Utils ----------------------------------------------------------------

function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#0d1117" : "#ffffff";
}
