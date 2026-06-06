import {
  CreateProfileRequestSchema,
  SwitchProfileRequestSchema
} from "@ai-music-companion/shared";
import type { FastifyInstance } from "fastify";

import type { LocalProfileService } from "../services/localProfileService.js";

interface ProfileRouteDeps {
  localProfileService: LocalProfileService;
}

export async function registerProfileRoutes(
  app: FastifyInstance,
  deps: ProfileRouteDeps
) {
  app.get("/api/profiles", async () => deps.localProfileService.listProfiles());

  app.post("/api/profiles", async (request, reply) => {
    const parsed = CreateProfileRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        message: parsed.error.flatten()
      });
    }

    const profile = deps.localProfileService.createProfile(parsed.data);
    return {
      profile,
      profiles: deps.localProfileService.listProfiles()
    };
  });

  app.post("/api/profiles/switch", async (request, reply) => {
    const parsed = SwitchProfileRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        message: parsed.error.flatten()
      });
    }

    try {
      return deps.localProfileService.switchProfile(parsed.data.profileId);
    } catch (error) {
      return reply.status(404).send({
        message: error instanceof Error ? error.message : "Profile switch failed."
      });
    }
  });
}
