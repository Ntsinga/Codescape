import { useExplorerStore } from "./state/store";
import { UploadView } from "./views/UploadView";
import { ExplorerView } from "./views/ExplorerView";

export default function App() {
  const repoId = useExplorerStore((s) => s.repoId);
  return repoId ? <ExplorerView /> : <UploadView />;
}
