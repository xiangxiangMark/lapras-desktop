import React from "react";
import ReactDOM from "react-dom/client";

import DesktopSettingsWindow from "./DesktopSettingsWindow";
import DesktopShell from "./DesktopShell";
import OnboardingGuard from "./desktop/onboarding/OnboardingGuard";
import "./index.css";
import "./styles/tokens.css";
import "./styles/desktop-shell.css";
import "./styles/player.css";
import "./styles/chat.css";
import "./styles/popovers.css";
import "./styles/settings.css";
import "./styles/onboarding.css";

function serializeReason(reason: unknown) {
  if (reason instanceof Error) {
    return {
      name: reason.name,
      message: reason.message,
      stack: reason.stack
    };
  }

  return reason;
}

function registerRendererErrorLogging() {
  const desktopApi = window.lapras?.desktop;

  if (!desktopApi?.logRendererError) {
    return;
  }

  window.addEventListener("error", (event) => {
    desktopApi.logRendererError({
      level: "error",
      message: event.message,
      stack: event.error instanceof Error ? event.error.stack : undefined,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;

    desktopApi.logRendererError({
      level: "error",
      message:
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "unhandled renderer promise rejection",
      stack: reason instanceof Error ? reason.stack : undefined,
      reason: serializeReason(reason)
    });
  });
}

function getDesktopView() {
  const params = new URLSearchParams(window.location.search);
  return params.get("desktopView");
}

function resolveRootView() {
  const view = getDesktopView();
  if (view === "settings") return <DesktopSettingsWindow />;
  return (
    <OnboardingGuard>
      <DesktopShell />
    </OnboardingGuard>
  );
}

registerRendererErrorLogging();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {resolveRootView()}
  </React.StrictMode>
);
