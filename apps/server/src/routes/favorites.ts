import type { FastifyInstance } from "fastify";

import type { FavoriteService } from "../services/favoriteService.js";

interface FavoriteRouteDeps {
  favoriteService: FavoriteService;
}

export async function registerFavoriteRoutes(
  app: FastifyInstance,
  deps: FavoriteRouteDeps
) {
  app.get("/api/favorites/current-status", async () =>
    deps.favoriteService.getCurrentSongStatus()
  );

  app.post("/api/favorites/current", async () =>
    deps.favoriteService.favoriteCurrentSong()
  );

  app.delete("/api/favorites/current", async () =>
    deps.favoriteService.unfavoriteCurrentSong()
  );

  app.get("/api/favorites", async (request) => {
    const requestedLimit = Number(
      (request.query as { limit?: string } | undefined)?.limit ?? 100
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 200)
      : 100;

    return {
      favorites: deps.favoriteService.listFavorites(limit)
    };
  });
}
