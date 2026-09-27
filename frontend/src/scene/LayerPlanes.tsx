import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { LAYERS, PALETTE, layerY } from "./grammar";

/**
 * The vertical axis made visible: one faint glass plane per architecture layer
 * that has something on it (frontend at the top, external systems at the
 * bottom), each labelled in flat type at its edge, plus the system's spine.
 */
export function LayerPlanes({ layers, radius, spine }: { layers: number[]; radius: number; spine: boolean }) {
  if (layers.length === 0) return null;
  const half = radius + 2.5;
  const ys = layers.map(layerY);
  const top = Math.max(...ys);
  const bottom = Math.min(...ys);
  return (
    <group>
      {layers.map((l) => {
        const meta = LAYERS.find((x) => x.index === l);
        const y = layerY(l) - 0.9;
        const corners: [number, number, number][] = [[-half, y, -half], [half, y, -half], [half, y, half], [-half, y, half], [-half, y, -half]];
        return (
          <group key={l}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} raycast={() => null}>
              <planeGeometry args={[half * 2, half * 2]} />
              <meshBasicMaterial color={PALETTE.plane} transparent opacity={0.025} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
            <Line points={corners} color={PALETTE.plane} lineWidth={1} transparent opacity={0.16} />
            {meta && (
              <Html position={[-half, y, half]} style={{ pointerEvents: "none" }}>
                <div className="layer-label">{meta.label}</div>
              </Html>
            )}
          </group>
        );
      })}
      {spine && (
        <>
          <Line points={[[0, top + 2, 0], [0, bottom - 1.5, 0]]} color={PALETTE.cyan} lineWidth={1} transparent opacity={0.18} />
          <Html position={[0, top + 2.4, 0]} center style={{ pointerEvents: "none" }}>
            <div className="layer-label user">USER ↑</div>
          </Html>
        </>
      )}
    </group>
  );
}

