/// <reference types="vite/client" />

declare global {
  interface Window {
    __NOVA_DEBUG__?: boolean;
  }
}

export {};
