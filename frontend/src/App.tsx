import { useEffect } from "react";
import { SignedIn, SignedOut, SignIn, UserButton, useAuth } from "@clerk/clerk-react";
import { useExplorerStore } from "./state/store";
import { UploadView } from "./views/UploadView";
import { ExplorerView } from "./views/ExplorerView";
import { setAuthTokenGetter } from "./api/client";

function AuthedApp() {
  const repoId = useExplorerStore((s) => s.repoId);
  const { getToken } = useAuth();

  // Wires the api client (a plain module, outside React) to this session's
  // token getter so every request it makes carries the signed-in user's auth.
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  return (
    <>
      <div className="user-menu-fixed">
        <UserButton afterSignOutUrl="/" />
      </div>
      {repoId ? <ExplorerView /> : <UploadView />}
    </>
  );
}

export default function App() {
  return (
    <>
      <SignedIn>
        <AuthedApp />
      </SignedIn>
      <SignedOut>
        <div className="signin-screen">
          <div className="landing-glow" aria-hidden="true" />
          <img className="hero-logo" src="/icon.svg" alt="Codescape" width={64} height={64} />
          <h1 className="hero-title">Codescape</h1>
          <p className="hero-tagline">Sign in to explore and import your own repositories.</p>
          <SignIn
            routing="hash"
            appearance={{ elements: { header: { display: "none" }, logoBox: { display: "none" } } }}
          />
        </div>
      </SignedOut>
    </>
  );
}
