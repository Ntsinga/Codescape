import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { GraphEdge, SemanticLink } from "../api/types";
import type { ExplorerNode } from "../state/store";
import { PALETTE, linkDashed, linkOpacity, linkWidth } from "./grammar";
import type { Vec3 } from "./layout";

interface Curve {
  key: string;
  from: string;
  to: string;
  points: THREE.Vector3[];
  width: number;
  color: string;
  opacity: number;
  dashed: boolean;
  weight: number;
}

/**
 * Links drawn individually (own width, dashes, arrowhead). Everything beyond
 * this is batched into one instanced line-segments draw call, so wide levels
 * stay fast without hiding dependencies.
 */
const DETAILED_LINKS = 90;

/** A gentle arc so links don't slice through entities; same-plane links bow upward, cross-plane ones bow outward. */
function arc(a: Vec3, b: Vec3): THREE.Vector3[] {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const dist = va.distanceTo(vb);
  if (Math.abs(a[1] - b[1]) < 0.5) mid.y += dist * 0.12;
  else {
    const out = new THREE.Vector3(mid.x, 0, mid.z);
    if (out.lengthSq() > 0.001) mid.add(out.normalize().multiplyScalar(dist * 0.08));
  }
  return new THREE.QuadraticBezierCurve3(va, mid, vb).getPoints(24);
}

export interface LinksProps {
  positions: Map<string, Vec3>;
  nodesById: Map<string, ExplorerNode>;
  accents: Map<string, string>;
  links: SemanticLink[];
  /** Physical-layer edges (Files layer), drawn plainly. */
  edges: GraphEdge[];
  /** Links on the active flow, keyed "from>to". */
  flowKeys: Set<string>;
  /** Node ids whose links should carry particles (selected / hovered). */
  focusIds: Set<string>;
  /** When set, links not touching these ids fade. */
  litIds: Set<string> | null;
}

export function Links({ positions, nodesById, accents, links, edges, flowKeys, focusIds, litIds }: LinksProps) {
  const curves = useMemo<Curve[]>(() => {
    const visible = links.filter((l) => positions.has(l.from) && positions.has(l.to));
    const top = visible.sort((a, b) => b.weight - a.weight);
    const maxW = Math.max(1, ...top.map((l) => l.weight));
    const semantic = top.map<Curve>((l) => {
      const target = nodesById.get(l.to);
      return {
        key: `${l.from}>${l.to}`,
        from: l.from,
        to: l.to,
        points: arc(positions.get(l.from)!, positions.get(l.to)!),
        width: linkWidth(l.weight),
        color: target?.type === "External" ? PALETTE.amber : accents.get(l.from) ?? PALETTE.cyan,
        opacity: linkOpacity(l.weight, maxW),
        dashed: linkDashed(l, target),
        weight: l.weight,
      };
    });
    const physical = edges
      .filter((e) => e.type !== "Contains" && positions.has(e.fromNodeId) && positions.has(e.toNodeId))
      .map<Curve>((e) => ({
        key: e.id,
        from: e.fromNodeId,
        to: e.toNodeId,
        points: arc(positions.get(e.fromNodeId)!, positions.get(e.toNodeId)!),
        width: 1.2,
        color: e.type === "Imports" ? "#6fa8dc" : "#f0a070",
        opacity: 0.5,
        dashed: e.confidence === "framework-derived",
        weight: 1,
      }));
    return [...semantic, ...physical];
  }, [links, edges, positions, nodesById, accents]);

  const lit = (c: Curve) => !litIds || (litIds.has(c.from) && litIds.has(c.to));
  const isActive = (c: Curve) => flowKeys.has(c.key) || focusIds.has(c.from) || focusIds.has(c.to);
  const active = curves.filter(isActive);
  // Strongest links + anything on the flow / touching the selection get full treatment; the rest batch.
  const detailed = curves.filter((c, i) => i < DETAILED_LINKS || isActive(c) || (litIds !== null && lit(c)));
  const detailedKeys = new Set(detailed.map((c) => c.key));
  const batched = curves.filter((c) => !detailedKeys.has(c.key));

  return (
    <>
      <BatchedLinks curves={batched} faded={litIds !== null} />
      {detailed.map((c) => {
        const onFlow = flowKeys.has(c.key);
        const faded = !lit(c) && !onFlow;
        return (
          <group key={c.key}>
            <Line
              points={c.points}
              color={onFlow ? PALETTE.white : c.color}
              lineWidth={onFlow ? c.width + 1 : c.width}
              dashed={c.dashed}
              dashSize={0.35}
              gapSize={0.25}
              transparent
              opacity={faded ? 0.05 : onFlow ? 0.95 : c.opacity}
            />
            {!faded && <Arrowhead points={c.points} color={onFlow ? PALETTE.white : c.color} width={c.width} opacity={onFlow ? 1 : c.opacity + 0.2} />}
          </group>
        );
      })}
      <Particles curves={active} flowKeys={flowKeys} />
    </>
  );
}

/** One draw call for the long tail of links: thin, vertex-coloured, no dashes. */
function BatchedLinks({ curves, faded }: { curves: Curve[]; faded: boolean }) {
  const geometry = useMemo(() => {
    const segs = curves.reduce((n, c) => n + c.points.length - 1, 0);
    const pos = new Float32Array(segs * 6);
    const col = new Float32Array(segs * 6);
    const color = new THREE.Color();
    let o = 0;
    for (const c of curves) {
      color.set(c.color);
      for (let i = 0; i < c.points.length - 1; i++) {
        const a = c.points[i];
        const b = c.points[i + 1];
        pos.set([a.x, a.y, a.z, b.x, b.y, b.z], o);
        col.set([color.r, color.g, color.b, color.r, color.g, color.b], o);
        o += 6;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, [curves]);
  if (curves.length === 0) return null;
  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial vertexColors transparent opacity={faded ? 0.04 : 0.28} depthWrite={false} />
    </lineSegments>
  );
}

/** Small cone at ~62% along the arc pointing from → to (direction of control/data flow). */
function Arrowhead({ points, color, width, opacity }: { points: THREE.Vector3[]; color: string; width: number; opacity: number }) {
  const { position, quaternion } = useMemo(() => {
    const i = Math.floor(points.length * 0.62);
    const p = points[i];
    const dir = points[Math.min(points.length - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
    return { position: p, quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir) };
  }, [points]);
  const s = 0.07 + width * 0.035;
  return (
    <mesh position={position} quaternion={quaternion}>
      <coneGeometry args={[s, s * 2.6, 10]} />
      <meshBasicMaterial color={color} transparent opacity={Math.min(1, opacity)} toneMapped={false} />
    </mesh>
  );
}

/** Instanced particles travelling along active links — requests/data moving through the system. */
function Particles({ curves, flowKeys }: { curves: Curve[]; flowKeys: Set<string> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const slots = useMemo(() => {
    const out: Array<{ curve: Curve; offset: number; speed: number }> = [];
    for (const c of curves) {
      const n = flowKeys.has(c.key) ? 4 : Math.min(3, 1 + Math.floor(Math.log2(1 + c.weight)));
      for (let i = 0; i < n; i++) out.push({ curve: c, offset: i / n, speed: flowKeys.has(c.key) ? 0.45 : 0.25 });
    }
    return out.slice(0, 600);
  }, [curves, flowKeys]);
  const tmp = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const t = clock.elapsedTime;
    slots.forEach((s, i) => {
      const u = (t * s.speed + s.offset) % 1;
      const pts = s.curve.points;
      const f = u * (pts.length - 1);
      const a = pts[Math.floor(f)];
      const b = pts[Math.min(pts.length - 1, Math.floor(f) + 1)];
      tmp.position.lerpVectors(a, b, f - Math.floor(f));
      tmp.scale.setScalar(flowKeys.has(s.curve.key) ? 1.4 : 1);
      tmp.updateMatrix();
      mesh.current!.setMatrixAt(i, tmp.matrix);
    });
    mesh.current.count = slots.length;
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  if (slots.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, Math.max(1, slots.length)]} key={slots.length}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial color={PALETTE.white} transparent opacity={0.9} toneMapped={false} />
    </instancedMesh>
  );
}
