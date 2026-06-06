import type { FastifyInstance } from "fastify";
import type { DatabaseClient } from "../db/sqlite.js";
import type { OnboardingStatus, OnboardingStepStatus } from "@ai-music-companion/shared";
import { safeJsonParse } from "../utils/json.js";
import type { SettingsService } from "../services/settingsService.js";

interface OnboardingRouteDeps {
  db: DatabaseClient;
  settingsService: SettingsService;
}

const ONBOARDING_KEY = "onboarding_status";

function getOnboardingStatus(db: DatabaseClient): OnboardingStatus {
  const row = db
    .prepare("SELECT value FROM preferences WHERE key = ?")
    .get(ONBOARDING_KEY) as { value: string } | undefined;

  if (!row) {
    return {
      completed: false,
      steps: {
        apiKey: false,
        neteaseLogin: false,
        modeChoice: false
      }
    };
  }

  const parsed = safeJsonParse<Partial<{
    completed: boolean;
    steps: OnboardingStepStatus;
  }>>(row.value, {});

  return {
    completed: parsed.completed ?? false,
    steps: {
      apiKey: parsed.steps?.apiKey ?? false,
      neteaseLogin: parsed.steps?.neteaseLogin ?? false,
      modeChoice: parsed.steps?.modeChoice ?? false
    }
  };
}

function setOnboardingStatus(
  db: DatabaseClient,
  status: OnboardingStatus
) {
  const value = JSON.stringify(status);
  const updatedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO preferences (key, value, updated_at)
    VALUES (@key, @value, @updatedAt)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run({
    key: ONBOARDING_KEY,
    value,
    updatedAt
  });

  return status;
}

export async function registerOnboardingRoutes(
  app: FastifyInstance,
  deps: OnboardingRouteDeps
) {
  app.get("/api/onboarding/status", async () => {
    return getOnboardingStatus(deps.db);
  });

  app.post("/api/onboarding/complete", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;

    // Allow partial step completion by passing steps in body
    if (body?.steps && typeof body.steps === "object") {
      const current = getOnboardingStatus(deps.db);
      const incoming = body.steps as Record<string, boolean>;

      if (typeof incoming.apiKey === "boolean") {
        current.steps.apiKey = incoming.apiKey;
      }
      if (typeof incoming.neteaseLogin === "boolean") {
        current.steps.neteaseLogin = incoming.neteaseLogin;
      }
      if (typeof incoming.modeChoice === "boolean") {
        current.steps.modeChoice = incoming.modeChoice;
      }

      // Auto-complete when all steps done
      if (
        current.steps.apiKey &&
        current.steps.neteaseLogin &&
        current.steps.modeChoice
      ) {
        current.completed = true;
      }

      return setOnboardingStatus(deps.db, current);
    }

    // Full completion
    return setOnboardingStatus(deps.db, {
      completed: true,
      steps: {
        apiKey: true,
        neteaseLogin: true,
        modeChoice: true
      }
    });
  });

  app.post("/api/onboarding/step", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;

    if (!body?.step || typeof body.step !== "string") {
      return reply.status(400).send({
        message: "step field is required (apiKey, neteaseLogin, modeChoice)"
      });
    }

    const validSteps = ["apiKey", "neteaseLogin", "modeChoice"];
    const step = body.step as string;

    if (!validSteps.includes(step)) {
      return reply.status(400).send({
        message: `Invalid step: ${step}. Must be one of: ${validSteps.join(", ")}`
      });
    }

    const current = getOnboardingStatus(deps.db);
    current.steps[step as keyof OnboardingStepStatus] = true;

    // Auto-complete when all steps done
    if (
      current.steps.apiKey &&
      current.steps.neteaseLogin &&
      current.steps.modeChoice
    ) {
      current.completed = true;
    }

    return setOnboardingStatus(deps.db, current);
  });

  // 验证已保存的 API Key 是否有效，向 LLM 发送一次最小模型调用
  app.post("/api/onboarding/validate-key", async (_request, reply) => {
    const settings = deps.settingsService.getRuntimeSettings();
    const apiKey = deps.settingsService.getDeepseekApiKey();

    if (!apiKey.trim()) {
      return { valid: false, message: "未找到 API Key，请先保存。" };
    }

    try {
      const response = await fetch(`${settings.deepseekBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: settings.deepseekModel,
          max_tokens: 5,
          temperature: 0,
          messages: [
            { role: "user", content: "Reply with exactly one word: OK" }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let message = `API 返回错误 (${response.status})`;

        // 尝试解析常见错误
        if (response.status === 401 || response.status === 403) {
          message = "API Key 无效，请检查 Key 是否正确。";
        } else if (response.status === 429) {
          message = "API 请求频率过高，请稍后再试。";
        } else if (errorText) {
          try {
            const parsed = JSON.parse(errorText) as { error?: { message?: string } };
            if (parsed.error?.message) {
              message = parsed.error.message;
            }
          } catch {
            // 使用默认消息
          }
        }

        return { valid: false, message };
      }

      return { valid: true, message: "API Key 验证通过" };
    } catch (error) {
      return {
        valid: false,
        message: `无法连接到 API 服务: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  });
}
