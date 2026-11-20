/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Destination of the "Pobierz" button. Falls back to the public releases page. */
  readonly VITE_DOWNLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
