import type { FastifyInstance } from "fastify";

import type { MusicProfileService } from "../services/musicProfileService.js";

interface MusicProfileRouteDeps {
  musicProfileService: MusicProfileService;
}

export async function registerMusicProfileRoutes(
  app: FastifyInstance,
  deps: MusicProfileRouteDeps
) {
  app.get("/api/music-profile", async () => deps.musicProfileService.getState());

  app.get("/api/music-profile/versions", async (request) => {
    const requestedLimit = Number(
      (request.query as { limit?: string } | undefined)?.limit ?? 10
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 20)
      : 10;

    return {
      versions: deps.musicProfileService.getVersions(limit)
    };
  });

  app.post("/api/music-profile/update", async () => {
    const job = await deps.musicProfileService.requestUpdate("manual");

    return {
      job,
      state: deps.musicProfileService.getState()
    };
  });

  app.post(
    "/api/music-profile/versions/:id/activate",
    async (request, reply) => {
      try {
        const { id } = request.params as Record<string, string | undefined>;
        if (!id) {
          reply.code(400);
          return { error: "缺少版本 ID" };
        }
        const version = deps.musicProfileService.activateVersion(id);
        return {
          currentVersion: version,
          state: deps.musicProfileService.getState()
        };
      } catch (error) {
        reply.code(400);
        return { error: error instanceof Error ? error.message : "激活失败" };
      }
    }
  );

  app.delete(
    "/api/music-profile/versions/:id",
    async (request, reply) => {
      try {
        const { id } = request.params as Record<string, string | undefined>;
        if (!id) {
          reply.code(400);
          return { error: "缺少版本 ID" };
        }
        const result = deps.musicProfileService.deleteVersion(id);
        return {
          ...result,
          state: deps.musicProfileService.getState()
        };
      } catch (error) {
        reply.code(400);
        return { error: error instanceof Error ? error.message : "删除失败" };
      }
    }
  );

  app.get("/api/music-profile/jobs/latest", async () => ({
    job: deps.musicProfileService.getLatestJob()
  }));
}
