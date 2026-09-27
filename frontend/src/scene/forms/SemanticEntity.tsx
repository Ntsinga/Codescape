import { useFrame } from "@react-three/fiber";
import { Edges, Line } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Archetype } from "../../api/types";
import type { ExplorerNode } from "../../state/store";
import { PALETTE, archetypeOf, couplingOf, haloOf, riskColor, shellOpacity } from "../grammar";

/**
 * Holographic system entities. Every form is built from the same three parts —
 * a translucent shell, a thin luminous frame and a glowing core — and the
 * arrangement of those parts is what tells you the component type:
 *
 *   System    gyroscope core (the system's semantic centre)
 *   Domain    glass architectural volume with orbiting components inside
 *   Service   bright core with one radial spoke per dependency
 *   Gateway   horizontal portal ring: traffic passes through it between layers
 *   Interface floating glass screen with a scanline
 *   Logic     octahedral frame around a core
 *   Data      stacked reservoir discs with drifting data points
 *   External  amber portal outside the system
 *   Support   small dim wireframe (tests, config, docs)
 *   Function  small solid node
 */

export interface VisualState {
  selected: boolean;
  hovered: boolean;
  /** Something else is highlighted (flow / why / time) and this isn't part of it. */
  dimmed: boolean;
  /** On the active flow: 0..1 pulse strength. */
  pulse: number;
  /** Recent change activity from git history, 0..1. */
  activity: number;
  /** Context anchor or not-yet-existing at the timeline position. */
  ghost: boolean;
}

export interface EntityProps {
  node: ExplorerNode;
  size: number;
  accent: string;
  visual: VisualState;
  childCount: number;
  health: boolean;
  animate: boolean;
}

/** Opacity multiplier from state — dimmed/ghost fade, focus brightens. */
function presence(v: VisualState): number {
  if (v.ghost) return 0.35;
  if (v.dimmed) return 0.18;
  return 1;
}

/** Core brightness: hover/selection/flow/activity all read as "glow". */
function glow(v: VisualState): number {
  return 0.55 + (v.hovered ? 0.25 : 0) + (v.selected ? 0.35 : 0) + v.pulse * 0.6 + v.activity * 0.5;
}

function Core({ radius, color, intensity, k }: { radius: number; color: string; intensity: number; k: number }) {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[radius, 20, 20]} />
        <meshBasicMaterial color={color} transparent opacity={Math.min(1, 0.55 + intensity * 0.4) * k} toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[radius * 2.1, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.07 * intensity * k} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

function Shell({ children, opacity, frame, frameOpacity, k }: { children: React.ReactNode; opacity: number; frame: string; frameOpacity: number; k: number }) {
  return (
    <mesh>
      {children}
      <meshPhysicalMaterial color={frame} transparent opacity={opacity * k} roughness={0.15} metalness={0.1} depthWrite={false} side={THREE.DoubleSide} />
      <Edges color={frame} transparent opacity={frameOpacity * k} />
    </mesh>
  );
}

// ---- Forms --------------------------------------------------------------------

function SystemForm({ size, accent, visual, animate }: EntityProps) {
  const rings = useRef<THREE.Group>(null);
  const k = presence(visual);
  useFrame((_, dt) => {
    if (!animate || !rings.current) return;
    rings.current.rotation.y += dt * 0.25;
    rings.current.rotation.x += dt * 0.08;
  });
  return (
    <group>
      <group ref={rings}>
        <mesh>
          <icosahedronGeometry args={[size * 1.1, 1]} />
          <meshBasicMaterial color={accent} wireframe transparent opacity={0.12 * k} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[size * 1.35, 0.012, 8, 96]} />
          <meshBasicMaterial color={accent} transparent opacity={0.45 * k} toneMapped={false} />
        </mesh>
        <mesh rotation={[0.4, 0.9, 0]}>
          <torusGeometry args={[size * 1.2, 0.01, 8, 96]} />
          <meshBasicMaterial color={PALETTE.cyan} transparent opacity={0.3 * k} toneMapped={false} />
        </mesh>
      </group>
      <Core radius={size * 0.32} color={accent} intensity={glow(visual)} k={k} />
    </group>
  );
}

function DomainForm({ node, size, accent, visual, childCount, animate }: EntityProps) {
  const orbit = useRef<THREE.Group>(null);
  const k = presence(visual);
  const dots = Math.min(childCount, 8);
  useFrame((_, dt) => {
    if (animate && orbit.current) orbit.current.rotation.y += dt * 0.35;
  });
  const w = size * 2;
  const h = size * 1.15;
  return (
    <group>
      <Shell opacity={shellOpacity("Domain")} frame={accent} frameOpacity={visual.selected || visual.hovered ? 0.9 : 0.55} k={k}>
        <boxGeometry args={[w, h, w]} />
      </Shell>
      {/* Inner core: the domain's own semantic centre, shaped by where it mostly lives. */}
      <InnerMark node={node} size={size * 0.34} accent={accent} k={k} intensity={glow(visual)} />
      <group ref={orbit}>
        {Array.from({ length: dots }, (_, i) => {
          const a = (i / dots) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * size * 0.72, (i % 2 ? 0.12 : -0.12) * size, Math.sin(a) * size * 0.72]}>
              <sphereGeometry args={[size * 0.055, 10, 10]} />
              <meshBasicMaterial color={accent} transparent opacity={0.85 * k} toneMapped={false} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/** Small symbol inside a Domain hinting at its dominant layer (reservoir, portal, spokes…). */
function InnerMark({ node, size, accent, k, intensity }: { node: ExplorerNode; size: number; accent: string; k: number; intensity: number }) {
  switch (node.layerArchetype) {
    case "Data":
      return (
        <group>
          {[-0.35, 0, 0.35].map((y) => (
            <mesh key={y} position={[0, y * size, 0]}>
              <cylinderGeometry args={[size, size, size * 0.18, 24]} />
              <meshBasicMaterial color={accent} transparent opacity={0.5 * k} toneMapped={false} />
            </mesh>
          ))}
        </group>
      );
    case "Gateway":
      return (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[size, size * 0.12, 8, 40]} />
          <meshBasicMaterial color={accent} transparent opacity={0.8 * k} toneMapped={false} />
        </mesh>
      );
    case "Interface":
      return (
        <mesh>
          <boxGeometry args={[size * 1.8, size * 1.1, size * 0.08]} />
          <meshBasicMaterial color={accent} transparent opacity={0.55 * k} toneMapped={false} />
        </mesh>
      );
    default:
      return <Core radius={size * 0.7} color={accent} intensity={intensity} k={k} />;
  }
}

function ServiceForm({ node, size, accent, visual }: EntityProps) {
  const k = presence(visual);
  const spokes = Math.max(3, Math.min(10, node.metrics?.fanOut ?? 3));
  const lines = useMemo(
    () =>
      Array.from({ length: spokes }, (_, i) => {
        const a = (i / spokes) * Math.PI * 2;
        const tilt = (i % 3 - 1) * 0.25;
        return [new THREE.Vector3(Math.cos(a) * size * 0.35, 0, Math.sin(a) * size * 0.35), new THREE.Vector3(Math.cos(a) * size * 1.15, tilt * size, Math.sin(a) * size * 1.15)];
      }),
    [spokes, size]
  );
  return (
    <group>
      <Core radius={size * 0.33} color={accent} intensity={glow(visual)} k={k} />
      {lines.map((pts, i) => (
        <group key={i}>
          <Line points={pts} color={accent} lineWidth={1} transparent opacity={0.6 * k} />
          <mesh position={pts[1]}>
            <sphereGeometry args={[size * 0.05, 8, 8]} />
            <meshBasicMaterial color={accent} transparent opacity={0.8 * k} toneMapped={false} />
          </mesh>
        </group>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[size * 0.62, 0.008, 6, 64]} />
        <meshBasicMaterial color={PALETTE.frame} transparent opacity={0.35 * k} />
      </mesh>
    </group>
  );
}

function GatewayForm({ size, accent, visual, animate }: EntityProps) {
  const inner = useRef<THREE.Mesh>(null);
  const k = presence(visual);
  useFrame((_, dt) => {
    if (animate && inner.current) inner.current.rotation.z += dt * 0.6;
  });
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh>
        <torusGeometry args={[size * 0.85, size * 0.045, 10, 72]} />
        <meshBasicMaterial color={accent} transparent opacity={(0.7 + glow(visual) * 0.2) * k} toneMapped={false} />
      </mesh>
      <mesh ref={inner}>
        <torusGeometry args={[size * 0.6, size * 0.018, 6, 6]} />
        <meshBasicMaterial color={PALETTE.white} transparent opacity={0.5 * k} toneMapped={false} />
      </mesh>
      <mesh>
        <circleGeometry args={[size * 0.8, 48]} />
        <meshBasicMaterial color={accent} transparent opacity={0.08 * glow(visual) * k} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function InterfaceForm({ size, accent, visual, animate }: EntityProps) {
  const scan = useRef<THREE.Mesh>(null);
  const k = presence(visual);
  const w = size * 1.7;
  const h = size * 1.1;
  useFrame(({ clock }) => {
    if (animate && scan.current) scan.current.position.y = Math.sin(clock.elapsedTime * 0.9) * h * 0.42;
  });
  return (
    <group>
      <Shell opacity={shellOpacity("Interface")} frame={accent} frameOpacity={0.8} k={k}>
        <boxGeometry args={[w, h, size * 0.06]} />
      </Shell>
      <mesh ref={scan} position={[0, 0, size * 0.035]}>
        <planeGeometry args={[w * 0.94, h * 0.04]} />
        <meshBasicMaterial color={accent} transparent opacity={0.55 * k} toneMapped={false} />
      </mesh>
      <mesh position={[0, -h * 0.62, 0]}>
        <boxGeometry args={[w * 0.3, size * 0.03, size * 0.2]} />
        <meshBasicMaterial color={PALETTE.frame} transparent opacity={0.4 * k} />
      </mesh>
      <Core radius={size * 0.1} color={accent} intensity={glow(visual)} k={k} />
    </group>
  );
}

function LogicForm({ size, accent, visual, animate }: EntityProps) {
  const frame = useRef<THREE.Mesh>(null);
  const k = presence(visual);
  useFrame((_, dt) => {
    if (animate && frame.current) frame.current.rotation.y += dt * 0.2;
  });
  return (
    <group>
      <mesh ref={frame}>
        <octahedronGeometry args={[size * 0.95, 0]} />
        <meshPhysicalMaterial color={accent} transparent opacity={shellOpacity("Logic") * k} depthWrite={false} roughness={0.2} />
        <Edges color={accent} transparent opacity={0.8 * k} />
      </mesh>
      <Core radius={size * 0.22} color={accent} intensity={glow(visual)} k={k} />
    </group>
  );
}

function DataForm({ size, accent, visual, animate }: EntityProps) {
  const points = useRef<THREE.Group>(null);
  const k = presence(visual);
  useFrame(({ clock }) => {
    if (!animate || !points.current) return;
    points.current.children.forEach((c, i) => {
      c.position.y = Math.sin(clock.elapsedTime * 0.8 + i * 1.7) * size * 0.35;
    });
  });
  return (
    <group>
      {[-0.4, 0, 0.4].map((y) => (
        <mesh key={y} position={[0, y * size, 0]}>
          <cylinderGeometry args={[size * 0.85, size * 0.85, size * 0.16, 40]} />
          <meshPhysicalMaterial color={accent} transparent opacity={0.16 * k} depthWrite={false} roughness={0.15} />
          <Edges color={accent} transparent opacity={0.75 * k} threshold={20} />
        </mesh>
      ))}
      <group ref={points}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[Math.cos(i * 1.6) * size * 0.4, 0, Math.sin(i * 1.6) * size * 0.4]}>
            <sphereGeometry args={[size * 0.06, 8, 8]} />
            <meshBasicMaterial color={PALETTE.white} transparent opacity={0.8 * k * glow(visual)} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function ExternalForm({ size, visual, animate }: EntityProps) {
  const spin = useRef<THREE.Mesh>(null);
  const k = presence(visual);
  const color = PALETTE.amber;
  useFrame((_, dt) => {
    if (animate && spin.current) spin.current.rotation.y -= dt * 0.3;
  });
  return (
    <group>
      <mesh ref={spin}>
        <icosahedronGeometry args={[size * 0.75, 0]} />
        <meshBasicMaterial color={color} transparent opacity={0.04 * k} depthWrite={false} />
        <Edges color={color} transparent opacity={0.85 * k} />
      </mesh>
      <mesh>
        <torusGeometry args={[size * 1.05, 0.015, 8, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.55 * k} toneMapped={false} />
      </mesh>
      <Core radius={size * 0.16} color={color} intensity={glow(visual)} k={k} />
    </group>
  );
}

function SupportForm({ size, visual }: EntityProps) {
  const k = presence(visual);
  return (
    <mesh>
      <boxGeometry args={[size, size, size]} />
      <meshBasicMaterial color={PALETTE.dim} transparent opacity={0.05 * k} depthWrite={false} />
      <Edges color={PALETTE.dim} transparent opacity={0.9 * k} />
    </mesh>
  );
}

function FunctionForm({ size, accent, visual }: EntityProps) {
  const k = presence(visual);
  return (
    <group>
      <mesh>
        <sphereGeometry args={[size * 0.55, 20, 20]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.25 + glow(visual) * 0.35} transparent opacity={shellOpacity("Function") * k} roughness={0.35} />
      </mesh>
      <mesh>
        <sphereGeometry args={[size * 0.7, 16, 16]} />
        <meshBasicMaterial color={accent} wireframe transparent opacity={0.12 * k} />
      </mesh>
    </group>
  );
}

// ---- Overlays: halo, health, flow pulse ----------------------------------------

function Halo({ node, size, accent, visual }: EntityProps) {
  const halo = haloOf(node);
  if (!halo || visual.ghost) return null;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -size * 0.9, 0]}>
      <ringGeometry args={[size * halo.radius, size * halo.radius + 0.05, 64]} />
      <meshBasicMaterial color={accent} transparent opacity={halo.opacity * presence(visual)} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

/** Architectural weather: risk halo, coupling field, churn trail. Only in Health mode. */
function HealthMarks({ node, size, visual, animate }: EntityProps) {
  const trail = useRef<THREE.Group>(null);
  const m = node.metrics;
  useFrame((_, dt) => {
    if (animate && trail.current) trail.current.rotation.y += dt * (1 + visual.activity * 3);
  });
  if (!m) return null;
  const risk = riskColor(m.risk);
  const coupling = couplingOf(node);
  const ticks = Math.round(coupling * 24);
  return (
    <group>
      {risk && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -size * 0.9, 0]}>
          <ringGeometry args={[size * 1.5, size * 1.5 + 0.12 + (m.risk / 100) * 0.25, 64]} />
          <meshBasicMaterial color={risk} transparent opacity={0.75} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
        </mesh>
      )}
      {ticks > 0 &&
        Array.from({ length: ticks }, (_, i) => {
          const a = (i / ticks) * Math.PI * 2;
          const r0 = size * 1.25;
          const r1 = size * (1.45 + coupling * 0.35);
          return (
            <Line
              key={i}
              points={[[Math.cos(a) * r0, 0, Math.sin(a) * r0], [Math.cos(a) * r1, 0, Math.sin(a) * r1]]}
              color={coupling > 0.66 ? PALETTE.amber : PALETTE.frame}
              lineWidth={1}
              transparent
              opacity={0.55}
            />
          );
        })}
      {visual.activity > 0.05 && (
        <group ref={trail}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[Math.cos(i * 2.1) * size * 1.2, size * (0.3 + i * 0.25), Math.sin(i * 2.1) * size * 1.2]}>
              <sphereGeometry args={[size * 0.06, 8, 8]} />
              <meshBasicMaterial color={PALETTE.white} transparent opacity={visual.activity} toneMapped={false} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

function PulseRing({ size, accent, visual }: EntityProps) {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const t = (clock.elapsedTime * 1.2) % 1;
    ring.current.scale.setScalar(1 + t * 1.2);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8 * visual.pulse;
  });
  if (visual.pulse <= 0) return null;
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[size * 1.0, size * 1.08, 64]} />
      <meshBasicMaterial color={accent} transparent opacity={0.8} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

const FORMS: Partial<Record<Archetype, (p: EntityProps) => JSX.Element>> = {
  System: SystemForm,
  Domain: DomainForm,
  Service: ServiceForm,
  Gateway: GatewayForm,
  Interface: InterfaceForm,
  Data: DataForm,
  External: ExternalForm,
  Support: SupportForm,
  Function: FunctionForm,
  Logic: LogicForm,
};

export function SemanticEntity(props: EntityProps) {
  const Form = FORMS[archetypeOf(props.node)] ?? LogicForm;
  // Health mode: unused candidates fade, central nodes grow.
  const unusedFade = props.health && props.node.metrics?.unusedCandidate;
  const p = unusedFade ? { ...props, visual: { ...props.visual, dimmed: true } } : props;
  const centralScale = props.health ? 1 + (props.node.metrics?.centrality ?? 0) * 0.35 : 1;
  return (
    <group scale={centralScale}>
      <Form {...p} />
      <Halo {...p} />
      {props.health && <HealthMarks {...p} />}
      <PulseRing {...p} />
    </group>
  );
}
