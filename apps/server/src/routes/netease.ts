import type { FastifyInstance } from "fastify";
import {
  NeteaseCaptchaRequestSchema,
  NeteaseCellphoneLoginRequestSchema
} from "@ai-music-companion/shared";

import type { NeteaseAccountService } from "../services/neteaseAccountService.js";

interface NeteaseRouteDeps {
  neteaseAccountService: NeteaseAccountService;
}

export async function registerNeteaseRoutes(
  app: FastifyInstance,
  deps: NeteaseRouteDeps
) {
  app.get("/api/netease/status", async () => deps.neteaseAccountService.getStatus());

  app.post("/api/netease/sync-profile", async () =>
    deps.neteaseAccountService.syncProfile()
  );

  app.get("/api/netease/profile-summary", async () => ({
    profile: deps.neteaseAccountService.getCachedProfile()
  }));

  app.post("/api/netease/qr-login", async (_request, reply) => {
    try {
      return await deps.neteaseAccountService.createQrLoginSession();
    } catch (error) {
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Failed to create Netease QR login session."
      });
    }
  });

  app.get("/api/netease/qr-login/:key", async (request, reply) => {
    const key = (request.params as { key?: string }).key?.trim();

    if (!key) {
      return reply.status(400).send({
        message: "QR login key is required."
      });
    }

    return deps.neteaseAccountService.checkQrLoginSession(key);
  });

  app.post("/api/netease/captcha", async (request, reply) => {
    const parsed = NeteaseCaptchaRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        message: parsed.error.flatten()
      });
    }

    try {
      return await deps.neteaseAccountService.sendCaptcha(
        parsed.data.phone,
        parsed.data.countryCode
      );
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : "Failed to send captcha."
      });
    }
  });

  app.post("/api/netease/login/cellphone", async (request, reply) => {
    const parsed = NeteaseCellphoneLoginRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        message: parsed.error.flatten()
      });
    }

    try {
      return await deps.neteaseAccountService.loginWithCellphoneCaptcha(
        parsed.data.phone,
        parsed.data.captcha,
        parsed.data.countryCode
      );
    } catch (error) {
      return reply.status(400).send({
        message: error instanceof Error ? error.message : "Failed to login."
      });
    }
  });

  app.post("/api/netease/import-cookie", async (_request, reply) => {
    try {
      return await deps.neteaseAccountService.importCookieFromProfileFile();
    } catch (error) {
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Failed to import Netease cookie."
      });
    }
  });
}
