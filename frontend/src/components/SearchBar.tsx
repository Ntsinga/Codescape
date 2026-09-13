import { useMemo, useState } from "react";
import type { ExplorerNode } from "../state/store";
import { useExplorerStore } from "../state/store";

export function SearchBar() {
  const nodes = useExplorerStore((s) => s.nodes);
  const setFocusNode = useExplorerStore((s) => s.setFocusNode);
  const selectNode = useExplorerStore((s) => s.selectNode);
  const layer = useExplorerStore((s) => s.layer);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const results = useMemo<ExplorerNode[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return nodes.filter((n) => n.name.toLowerCase().includes(q)).slice(0, 30);
  }, [nodes, query]);

  function selectResult(node: ExplorerNode) {
    setOpen(false);
    setQuery("");
    if (node.parentId) setFocusNode(node.parentId);
    selectNode(node.id);
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        placeholder={layer === "semantic" ? "Search components, services, functions…" : "Search files, classes, functions…"}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ width: 240 }}
      />
      {open && results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={r.id} onMouseDown={() => selectResult(r)}>
              {r.name}
              <span className="type-tag">{r.type}</span>
              {r.filePath && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{r.filePath}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
