import { type ReactNode, useEffect, useState } from "react";

import { api } from "../../lib/api";
import OnboardingWizard from "./OnboardingWizard";

interface Props {
  children: ReactNode;
}

type GuardState =
  | { type: "loading"; message: string }
  | { type: "showOnboarding"; key: number }
  | { type: "showApp" }
  | { type: "backendUnavailable" };

const MAX_STATUS_ATTEMPTS = 20;

function getRetryDelayMs(attempt: number) {
  return Math.min(750 + attempt * 250, 3000);
}

export default function OnboardingGuard({ children }: Props) {
  const [retryToken, setRetryToken] = useState(0);
  const [state, setState] = useState<GuardState>({
    type: "loading",
    message: "正在启动 Lapras..."
  });

  useEffect(() => {
    let cancelled = false;
    let retryTimer = 0;

    async function loadStatus(attempt = 0) {
      setState({
        type: "loading",
        message:
          attempt === 0
            ? "正在启动 Lapras..."
            : "正在等待后端服务就绪..."
      });

      try {
        const status = await api.getOnboardingStatus({
          logErrors: attempt >= MAX_STATUS_ATTEMPTS
        });
        if (cancelled) {
          return;
        }

        if (status.completed) {
          setState({ type: "showApp" });
        } else {
          setState({ type: "showOnboarding", key: Date.now() });
        }
      } catch {
        if (cancelled) {
          return;
        }

        if (attempt < MAX_STATUS_ATTEMPTS) {
          retryTimer = window.setTimeout(() => {
            void loadStatus(attempt + 1);
          }, getRetryDelayMs(attempt));
          return;
        }

        setState({ type: "backendUnavailable" });
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [retryToken]);

  if (state.type === "loading") {
    return (
      <div className="onboarding-loading">
        <div className="onboarding-loading-spinner" />
        <p>{state.message}</p>
      </div>
    );
  }

  if (state.type === "backendUnavailable") {
    return (
      <div className="onboarding-loading">
        <p className="onboarding-loading-message">
          后端服务暂时不可用，无法确认首次引导状态。
        </p>
        <button
          className="onboarding-btn onboarding-btn-secondary onboarding-loading-retry"
          type="button"
          onClick={() => setRetryToken((value) => value + 1)}
        >
          重试
        </button>
      </div>
    );
  }

  if (state.type === "showOnboarding") {
    return (
      <OnboardingWizard
        key={state.key}
        onComplete={() => setState({ type: "showApp" })}
      />
    );
  }

  return <>{children}</>;
}
