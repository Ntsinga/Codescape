import { useExplorerStore } from "../state/store";

export function Breadcrumbs() {
  const breadcrumb = useExplorerStore((s) => s.breadcrumb);
  const setFocusNode = useExplorerStore((s) => s.setFocusNode);

  return (
    <div className="breadcrumbs">
      {breadcrumb.map((node, i) => (
        <span key={node.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {i > 0 && <span className="sep">/</span>}
          <button
            type="button"
            className={`crumb${i === breadcrumb.length - 1 ? " current" : ""}`}
            onClick={() => setFocusNode(node.id)}
          >
            {node.name}
          </button>
        </span>
      ))}
    </div>
  );
}
