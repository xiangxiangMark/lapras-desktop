import type { FastifyInstance } from "fastify";

import type { MessageService } from "../services/messageService.js";

interface MessageRouteDeps {
  messageService: MessageService;
}

export async function registerMessageRoutes(
  app: FastifyInstance,
  deps: MessageRouteDeps
) {
  app.get("/api/messages", async (request) => {
    const requestedLimit = Number(
      (request.query as { limit?: string } | undefined)?.limit ?? 8
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 50)
      : 8;

    return {
      messages: deps.messageService.getRecentMessages(limit)
    };
  });
}
