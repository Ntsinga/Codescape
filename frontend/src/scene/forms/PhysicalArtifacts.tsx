import { Edges, Html, RoundedBox } from "@react-three/drei";
import type { ExplorerNode } from "../../state/store";
import { PALETTE } from "../grammar";

/**
 * Forms for the physical Files layer (folders → files → classes → functions).
 * That layer is the raw structure, not the architecture, so it keeps literal
 * shapes — restyled to the map's palette (thin frames, no heavy glow/shadows).
 */

export const PHYSICAL_TINT: Record<string, string> = {
  Repository: PALETTE.white,
  Folder: "#7fa7e0",
  File: "#9ad0a8",
  Class: "#e0b35c",
  Interface: "#b9a2f0",
  Function: "#f0a070",
  ImportedModule: "#6e7681",
};

export const PHYSICAL_EMBLEM: Record<string, string> = {
  Repository: "◉",
  Folder: "📁",
  Class: "{ }",
  Interface: "<>",
  Function: "ƒ",
  ImportedModule: "⇢",
};

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

function readableOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#0d1117" : "#ffffff";
}

interface Props {
  node: ExplorerNode;
  selected: boolean;
  hovered: boolean;
}

function glowOf(selected: boolean, hovered: boolean) {
  return selected ? 0.8 : hovered ? 0.4 : 0.12;
}

export function PhysicalArtifact({ node, selected, hovered }: Props) {
  const tint = PHYSICAL_TINT[node.type] ?? PALETTE.frame;
  const g = glowOf(selected, hovered);
  switch (node.type) {
    case "Repository":
      return (
        <mesh>
          <icosahedronGeometry args={[0.8, 0]} />
          <meshBasicMaterial color={tint} transparent opacity={0.06} depthWrite={false} />
          <Edges color={tint} transparent opacity={0.6 + g * 0.4} />
        </mesh>
      );
    case "Folder":
      return (
        <group>
          <RoundedBox args={[1.35, 0.9, 0.12]} radius={0.05} smoothness={3} position={[0, 0.2, 0]}>
            <meshStandardMaterial color={tint} transparent opacity={0.25 + g * 0.3} emissive={tint} emissiveIntensity={g * 0.5} roughness={0.5} />
          </RoundedBox>
          <RoundedBox args={[0.6, 0.2, 0.12]} radius={0.04} smoothness={3} position={[-0.36, 0.72, 0]}>
            <meshStandardMaterial color={tint} transparent opacity={0.3} roughness={0.6} />
          </RoundedBox>
        </group>
      );
    case "File": {
      const badge = fileBadge(node);
      return (
        <group>
          <RoundedBox args={[0.95, 1.2, 0.07]} radius={0.04} smoothness={3}>
            <meshStandardMaterial color="#dfe8f2" transparent opacity={0.75} emissive={PALETTE.cyan} emissiveIntensity={g * 0.3} roughness={0.5} />
          </RoundedBox>
          <mesh position={[0, -0.42, 0.045]}>
            <planeGeometry args={[0.95, 0.28]} />
            <meshBasicMaterial color={badge.color} />
          </mesh>
          <Html position={[0, -0.42, 0.05]} center transform distanceFactor={5}>
            <div style={{ color: readableOn(badge.color), fontFamily: "monospace", fontWeight: 800, fontSize: 22, letterSpacing: 1 }}>{badge.label}</div>
          </Html>
        </group>
      );
    }
    case "Class":
      return (
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <octahedronGeometry args={[0.55, 0]} />
          <meshStandardMaterial color={tint} transparent opacity={0.35} emissive={tint} emissiveIntensity={g} />
          <Edges color={tint} />
        </mesh>
      );
    case "Interface":
      return (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.45, 0.1, 12, 40]} />
          <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={g} transparent opacity={0.8} />
        </mesh>
      );
    case "Function":
      return (
        <mesh>
          <sphereGeometry args={[0.33, 20, 20]} />
          <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={g} transparent opacity={0.85} />
        </mesh>
      );
    case "ImportedModule":
      return (
        <mesh rotation={[0, Math.PI / 4, 0]}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshBasicMaterial color={tint} wireframe transparent opacity={0.7} />
        </mesh>
      );
    default:
      return null;
  }
}
