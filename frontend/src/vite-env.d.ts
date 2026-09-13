/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute origin of the deployed backend (e.g. https://codescape-backend.onrender.com). Empty in dev. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
