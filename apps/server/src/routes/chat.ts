import type { FastifyInstance } from "fastify";

import { ChatRequestSchema } from "../schemas/api.js";
import type { ChatService } from "../services/chatService.js";

interface ChatRouteDeps {
  chatService: ChatService;
}

export async function registerChatRoutes(app: FastifyInstance, deps: ChatRouteDeps) {
  app.post("/api/chat", async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        message: parsed.error.flatten()
      });
    }

    const result = await deps.chatService.handleChat(parsed.data.message);
    return result;
  });
}
