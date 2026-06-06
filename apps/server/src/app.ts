import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";

import { db } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { config } from "./config.js";
import { DeepSeekLLMProvider } from "./providers/llm/DeepSeekLLMProvider.js";
import { NeteaseMusicProvider } from "./providers/music/NeteaseMusicProvider.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerFavoriteRoutes } from "./routes/favorites.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { registerMusicProfileRoutes } from "./routes/musicProfile.js";
import { registerNeteaseRoutes } from "./routes/netease.js";
import { registerOnboardingRoutes } from "./routes/onboarding.js";
import { registerPlaybackRoutes } from "./routes/playback.js";
import { registerProfileRoutes } from "./routes/profiles.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { ChatService } from "./services/chatService.js";
import { ContextAssemblerService } from "./services/contextAssemblerService.js";
import { FavoriteService } from "./services/favoriteService.js";
import { HistoryService } from "./services/historyService.js";
import { LocalProfileService } from "./services/localProfileService.js";
import { LongTermMemoryService } from "./services/longTermMemoryService.js";
import { MessageService } from "./services/messageService.js";
import { MemoryScopeService } from "./services/memoryScopeService.js";
import { ModeService } from "./services/modeService.js";
import { MusicProfileService } from "./services/musicProfileService.js";
import { NeteaseAccountService } from "./services/neteaseAccountService.js";
import { PlaybackService } from "./services/playbackService.js";
import { PreferenceSignalService } from "./services/preferenceSignalService.js";
import { ProfileService } from "./services/profileService.js";
import { RecommendationPolicyService } from "./services/recommendationPolicyService.js";
import { RecommendationPortraitService } from "./services/recommendationPortraitService.js";
import { RealtimeService } from "./services/realtimeService.js";
import { SettingsService } from "./services/settingsService.js";
import { StateService } from "./services/stateService.js";
import { ContextMemoryService } from "./services/contextMemoryService.js";

export async function buildApp() {
  runMigrations(db);

  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: true
  });

  await app.register(websocket);

  // 本地 token 认证：Electron 启动时生成随机 token，后端验证
  // 仅当 LAPRAS_LOCAL_TOKEN 环境变量存在时生效，否则允许所有请求（开发模式）
  if (config.localToken) {
    app.addHook("onRequest", async (request, reply) => {
      // /health 和 /ws 跳过 token 校验
      // Audio is requested by a media element, so it cannot attach custom headers.
      if (
        request.url === "/health" ||
        request.url === "/ws" ||
        request.url.startsWith("/api/audio/")
      ) {
        return;
      }
      const token = request.headers["x-lapras-token"];
      if (token !== config.localToken) {
        return reply.status(401).send({ message: "Unauthorized" });
      }
    });
  }

  app.get("/health", async () => ({ ok: true }));
  const localProfileService = new LocalProfileService(db);
  const getProfileId = () => localProfileService.getCurrentProfileId();
  const profileService = new ProfileService(config.profileDataDir, getProfileId);
  const memoryScopeService = new MemoryScopeService(db, profileService, getProfileId);
  const messageService = new MessageService(db, getProfileId, memoryScopeService);
  const historyService = new HistoryService(db, getProfileId, memoryScopeService);
  const stateService = new StateService(db, getProfileId);
  const settingsService = new SettingsService(db, {
    deepseekApiKey: config.deepseekApiKey,
    deepseekBaseUrl: config.deepseekBaseUrl,
    deepseekModel: config.deepseekModel,
    neteaseApiBaseUrl: config.neteaseApiBaseUrl,
    useMockNeteaseOnFailure: config.useMockNeteaseOnFailure
  }, getProfileId);
  const realtimeService = new RealtimeService();
  const neteaseAccountService = new NeteaseAccountService(
    db,
    settingsService,
    config.profileDataDir,
    getProfileId
  );
  const musicProvider = new NeteaseMusicProvider(settingsService);
  const llmProvider = new DeepSeekLLMProvider(settingsService);
  const preferenceSignalService = new PreferenceSignalService(
    db,
    getProfileId,
    memoryScopeService
  );
  const longTermMemoryService = new LongTermMemoryService(
    db,
    profileService,
    messageService,
    historyService,
    memoryScopeService,
    getProfileId
  );
  const musicProfileService = new MusicProfileService(
    db,
    memoryScopeService,
    historyService,
    preferenceSignalService,
    settingsService,
    getProfileId
  );
  const favoriteService = new FavoriteService(
    db,
    stateService,
    messageService,
    historyService,
    memoryScopeService,
    preferenceSignalService,
    musicProfileService,
    getProfileId
  );
  const contextMemoryService = new ContextMemoryService(
    messageService,
    historyService,
    longTermMemoryService,
    stateService
  );
  const recommendationPortraitService = new RecommendationPortraitService(
    profileService,
    longTermMemoryService,
    messageService,
    historyService,
    preferenceSignalService,
    musicProfileService
  );
  const recommendationPolicyService = new RecommendationPolicyService(
    profileService,
    recommendationPortraitService
  );
  const playbackService = new PlaybackService(
    musicProvider,
    historyService,
    recommendationPolicyService,
    stateService,
    realtimeService
  );
  const contextAssembler = new ContextAssemblerService(
    profileService,
    stateService,
    contextMemoryService,
    longTermMemoryService,
    recommendationPortraitService,
    musicProfileService
  );
  const chatService = new ChatService(
    contextAssembler,
    llmProvider,
    messageService,
    playbackService,
    stateService,
    preferenceSignalService,
    realtimeService
  );
  const modeService = new ModeService(
    contextAssembler,
    llmProvider,
    playbackService,
    stateService
  );

  app.get("/ws", { websocket: true }, (socket) => {
    realtimeService.register(socket, () => stateService.getNowPlayingState());
  });

  await registerChatRoutes(app, { chatService });
  await registerPlaybackRoutes(app, {
    playbackService,
    historyService,
    stateService,
    modeService,
    musicProvider,
    preferenceSignalService
  });
  await registerSettingsRoutes(app, { settingsService });
  await registerOnboardingRoutes(app, { db, settingsService });
  await registerNeteaseRoutes(app, { neteaseAccountService });
  await registerProfileRoutes(app, { localProfileService });
  await registerFavoriteRoutes(app, { favoriteService });
  await registerMessageRoutes(app, { messageService });
  await registerMusicProfileRoutes(app, { musicProfileService });

  return app;
}
