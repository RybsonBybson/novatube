import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toasts";
import { LanguageProvider } from "./lib/i18n/LanguageContext";
import { hideBootScreen } from "./lib/bootScreen";
import "./index.css";

/* Strict console lockdown: production builds do not expose logging APIs. */
if (import.meta.env.PROD && !window.__NOVA_DEBUG__) {
  const noop = () => undefined;
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.warn = noop;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    // The splash sits above everything, so it has to go before the error UI is
    // readable.
    hideBootScreen();
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("NovaTube renderer error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid h-screen w-screen place-items-center bg-ink-950 p-8 text-center">
          <div className="surface max-w-md rounded-[28px] p-8">
            <div className="mx-auto grid size-12 place-items-center rounded-[16px] bg-sky text-lg text-on-sky">✦</div>
            <h1 className="mt-5 font-display text-xl font-bold text-mist">Something went off-orbit</h1>
            <p className="mt-2 text-[12px] leading-relaxed text-mute">{this.state.error.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-full bg-sky px-5 py-2 text-[12px] font-semibold text-on-sky"
            >
              Restart interface
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <LanguageProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </LanguageProvider>
      </ErrorBoundary>
    </StrictMode>,
  );

  /* Last-resort net: the app drives the splash away as soon as the launch
   * update check settles, but a failure before it can do that must never leave
   * the window on a frozen splash. */
  window.setTimeout(hideBootScreen, 20000);
}
