import { RuntimeSettingsUpdateSchema } from "@ai-music-companion/shared";
import type { FastifyInstance } from "fastify";

import type { SettingsService } from "../services/settingsService.js";

interface SettingsRouteDeps {
  settingsService: SettingsService;
}

export async function registerSettingsRoutes(
  app: FastifyInstance,
  deps: SettingsRouteDeps
) {
  app.get("/api/settings", async () => deps.settingsService.getRuntimeSettings());

  app.put("/api/settings", async (request, reply) => {
    const parsed = RuntimeSettingsUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        message: parsed.error.flatten()
      });
    }

    return deps.settingsService.updateRuntimeSettings(parsed.data);
  });
}
