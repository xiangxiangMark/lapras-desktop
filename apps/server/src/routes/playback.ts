import { Readable } from "node:stream";

import { z } from "zod";

import type { FastifyInstance } from "fastify";
import { AppModeSchema } from "@ai-music-companion/shared";

import type { NeteaseMusicProvider } from "../providers/music/NeteaseMusicProvider.js";
import { PlaybackFeedbackRequestSchema, PlayRequestSchema } from "../schemas/api.js";
import type { HistoryService } from "../services/historyService.js";
import type { ModeService } from "../services/modeService.js";
import type { PlaybackService } from "../services/playbackService.js";
import type { PreferenceSignalService } from "../services/preferenceSignalService.js";
import type { StateService } from "../services/stateService.js";

interface PlaybackRouteDeps {
  playbackService: PlaybackService;
  historyService: HistoryService;
  stateService: StateService;
  modeService: ModeService;
  musicProvider: NeteaseMusicProvider;
  preferenceSignalService: PreferenceSignalService;
}

export async function registerPlaybackRoutes(
  app: FastifyInstance,
  deps: PlaybackRouteDeps
) {
  app.get("/api/now", async () => deps.stateService.getNowPlayingState());

  app.get("/api/audio/netease/:songId", async (request, reply) => {
    const { songId } = request.params as { songId?: string };

    if (!songId) {
      return reply.status(400).send({ message: "songId is required." });
    }

    try {
      const upstreamUrl = await deps.musicProvider.resolveAudioStreamUrl(songId);

      if (!upstreamUrl) {
        return reply.status(404).send({ message: "Audio stream is unavailable." });
      }

      const range =
        typeof request.headers.range === "string" ? request.headers.range : null;

      const upstreamResponse = await fetch(upstreamUrl, {
        headers: deps.musicProvider.getAudioRequestHeaders(range)
      });

      if (!upstreamResponse.ok || !upstreamResponse.body) {
        return reply.status(upstreamResponse.status || 502).send({
          message: `Audio proxy request failed: ${upstreamResponse.status}`
        });
      }

      reply.code(upstreamResponse.status);

      for (const headerName of [
        "accept-ranges",
        "cache-control",
        "content-length",
        "content-range",
        "content-type",
        "etag",
        "last-modified"
      ]) {
        const value = upstreamResponse.headers.get(headerName);

        if (value) {
          reply.header(headerName, value);
        }
      }

      return reply.send(Readable.fromWeb(upstreamResponse.body as any));
    } catch {
      return reply.status(502).send({ message: "Audio proxy request failed." });
    }
  });

  app.post("/api/play", async (request, reply) => {
    const parsed = PlayRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        message: parsed.error.flatten()
      });
    }

    if (parsed.data.songId) {
      return deps.playbackService.playSongById(
        parsed.data.songId,
        "manual",
        "User manually selected a track"
      );
    }

    return deps.playbackService.playFirstByQuery(
      parsed.data.query ?? "",
      "User manually searched and played a track"
    );
  });

  app.post("/api/next", async () =>
    deps.playbackService.skipTrack("User requested next track")
  );

  app.post("/api/previous", async () =>
    deps.playbackService.previousTrack("User requested previous track")
  );

  app.post("/api/play/from-queue", async (request, reply) => {
    const parsed = z
      .object({ sourceId: z.string().min(1) })
      .safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.flatten() });
    }

    return deps.playbackService.playFromQueue(parsed.data.sourceId);
  });

  app.post("/api/play/from-played", async (request, reply) => {
    const parsed = z
      .object({ sourceId: z.string().min(1) })
      .safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.flatten() });
    }

    return deps.playbackService.replayFromPlayed(parsed.data.sourceId);
  });

  app.post("/api/queue/clear", async () => deps.playbackService.clearQueue());

  app.post("/api/mode", async (request, reply) => {
    const parsed = AppModeSchema.safeParse(
      (request.body as { mode?: unknown } | undefined)?.mode
    );

    if (!parsed.success) {
      return reply.status(400).send({
        message: parsed.error.flatten()
      });
    }

    return deps.modeService.switchModeFromUi(parsed.data);
  });

  app.post("/api/playback/feedback", async (request, reply) => {
    const parsed = PlaybackFeedbackRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        message: parsed.error.flatten()
      });
    }

    const result = deps.historyService.updatePlaybackFeedback(parsed.data);

    if (
      result?.record &&
      (parsed.data.event === "paused" ||
        parsed.data.event === "completed" ||
        parsed.data.event === "skipped")
    ) {
      deps.preferenceSignalService.recordPlaybackFeedbackSignal(
        parsed.data.event,
        result.record,
        parsed.data.reason
      );
    }

    return result ?? { ok: true };
  });

  app.get("/api/history", async (request) => {
    const requestedLimit = Number(
      (request.query as { limit?: string } | undefined)?.limit ?? 30
    );
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 30)
      : 30;

    return deps.historyService.getRecentHistory(limit);
  });
}
