import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { getSource } from "../api/client";
import { useExplorerStore } from "../state/store";

const LANGUAGE_MAP: Record<string, string> = {
  typescript: "typescript",
  javascript: "javascript",
  python: "python",
  csharp: "csharp",
};

export function SourceViewer() {
  const repoId = useExplorerStore((s) => s.repoId);
  const selectedNodeId = useExplorerStore((s) => s.selectedNodeId);
  const nodesById = useExplorerStore((s) => s.nodesById);
  const node = selectedNodeId ? nodesById.get(selectedNodeId) : null;

  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const decorationsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!repoId || !node?.filePath) {
      setContent("");
      return;
    }
    getSource(repoId, node.filePath)
      .then((res) => {
        setContent(res.content);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load source"));
  }, [repoId, node?.filePath]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !node?.startLine || !node?.endLine) return;
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
      {
        range: { startLineNumber: node.startLine, startColumn: 1, endLineNumber: node.endLine, endColumn: 1 },
        options: { isWholeLine: true, className: "highlighted-range", linesDecorationsClassName: "highlighted-range-gutter" },
      },
    ]);
    editor.revealLineInCenter(node.startLine);
  }, [content, node?.startLine, node?.endLine]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    if (node?.startLine) editor.revealLineInCenter(node.startLine);
  };

  if (!node?.filePath) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-dim)" }}>
        Select a file, class, or function to view its source.
      </div>
    );
  }

  if (error) {
    return <div style={{ padding: 16, color: "var(--red)" }}>{error}</div>;
  }

  return (
    <Editor
      key={node.filePath}
      height="100%"
      theme="vs-dark"
      language={LANGUAGE_MAP[node.language ?? ""] ?? "plaintext"}
      value={content}
      onMount={handleMount}
      options={{ readOnly: true, minimap: { enabled: true }, fontSize: 13 }}
    />
  );
}
