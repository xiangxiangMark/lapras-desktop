import type { ChatResponse, LLMDecision, LLMMusicPlan } from "@ai-music-companion/shared";

import type { LLMProvider } from "../providers/llm/LLMProvider.js";
import { ContextAssemblerService } from "./contextAssemblerService.js";
import { MessageService } from "./messageService.js";
import { PlaybackService } from "./playbackService.js";
import { PreferenceSignalService } from "./preferenceSignalService.js";
import { RealtimeService } from "./realtimeService.js";
import { StateService } from "./stateService.js";

export class ChatService {
  constructor(
    private readonly contextAssembler: ContextAssemblerService,
    private readonly llmProvider: LLMProvider,
    private readonly messageService: MessageService,
    private readonly playbackService: PlaybackService,
    private readonly stateService: StateService,
    private readonly preferenceSignalService: PreferenceSignalService,
    private readonly realtimeService: RealtimeService
  ) {}

  async handleChat(input: string): Promise<ChatResponse> {
    this.messageService.createMessage("user", input);
    this.preferenceSignalService.recordSignalsFromUserInput(
      input,
      this.stateService.getMode(),
      this.stateService.getCurrentSong()?.sourceId
    );

    const context = this.contextAssembler.build(input);
    const rawDecision = await this.llmProvider.generateDecision(context);
    const decision = await this.applyDecision(rawDecision);

    this.stateService.setLastDecision(decision);

    const reply = this.messageService.createMessage(
      "assistant",
      decision.reply?.text?.trim() || decision.say,
      decision
    );
    const state = this.stateService.getNowPlayingState();
    this.realtimeService.broadcast(state);

    return {
      reply,
      decision,
      state
    };
  }

  private async applyDecision(decision: LLMDecision): Promise<LLMDecision> {
    const plan = decision.musicPlan ?? this.legacyActionToMusicPlan(decision);
    const effectiveMode = plan.action === "switch_mode" ? plan.nextMode : decision.mode;
    this.stateService.setMode(effectiveMode);

    try {
      switch (plan.action) {
        case "search_and_queue":
          await this.playbackService.playRecommendedQueue(
            plan.query,
            plan.queueQueries ?? [],
            plan.tuning,
            decision.reason,
            "ai",
            effectiveMode
          );
          break;
        case "play_track":
          await this.playbackService.playSongById(
            plan.songId,
            "ai",
            decision.reason,
            effectiveMode
          );
          break;
        case "skip_track":
          await this.playbackService.skipTrack(decision.reason);
          break;
        case "switch_mode":
        case "none":
          break;
        default:
          return {
            ...decision,
            mode: effectiveMode
          };
      }

      return {
        ...decision,
        mode: effectiveMode
      };
    } catch {
      const baseText = decision.reply?.text?.trim() || decision.say;
      const fallbackText = `${baseText} 不过这次播放动作没有成功，我先陪你把方向留住。`;
      const fallbackReason =
        decision.reply?.displayReason?.trim() ||
        decision.reason?.trim() ||
        "播放动作执行失败，已回退为仅回复。";

      return {
        ...decision,
        mode: effectiveMode,
        musicPlan: { action: "none" },
        action: { type: "speak_only" },
        reply: {
          text: fallbackText,
          mood: decision.reply?.mood ?? "soft",
          displayReason: fallbackReason
        },
        say: fallbackText,
        reason: fallbackReason,
        segue: "可以继续换个说法点歌，或者先聊聊你想要的感觉。"
      };
    }
  }

  private legacyActionToMusicPlan(decision: LLMDecision): LLMMusicPlan {
    switch (decision.action.type) {
      case "search_and_queue":
        return {
          action: "search_and_queue",
          query: decision.action.query,
          queueQueries: decision.action.queueQueries,
          tuning: decision.action.recommendationTuning
        };
      case "play_track":
        return { action: "play_track", songId: decision.action.songId };
      case "skip_track":
        return { action: "skip_track" };
      case "switch_mode":
        return { action: "switch_mode", nextMode: decision.action.nextMode };
      case "speak_only":
      default:
        return { action: "none" };
    }
  }
}
