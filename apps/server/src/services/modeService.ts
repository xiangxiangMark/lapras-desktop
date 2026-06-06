import type { AppMode, NowPlayingState } from "@ai-music-companion/shared";

import type { LLMProvider } from "../providers/llm/LLMProvider.js";
import { ContextAssemblerService } from "./contextAssemblerService.js";
import { PlaybackService } from "./playbackService.js";
import { StateService } from "./stateService.js";

const modeLabels: Record<AppMode, string> = {
  companion: "陪伴",
  focus: "专注",
  discover: "发现",
  sleep: "夜间"
};

// Handles UI-driven mode switches without turning them into visible chat turns.
export class ModeService {
  constructor(
    private readonly contextAssembler: ContextAssemblerService,
    private readonly llmProvider: LLMProvider,
    private readonly playbackService: PlaybackService,
    private readonly stateService: StateService
  ) {}

  switchModeFromUi(mode: AppMode): NowPlayingState {
    const state = this.playbackService.switchMode(mode);
    void this.refreshQueueWithLLM(mode);
    return state;
  }

  private async refreshQueueWithLLM(mode: AppMode) {
    const label = modeLabels[mode];

    try {
      const context = this.contextAssembler.build(
        `UI_MODE_SWITCH:${mode}。用户通过界面手动切换到${label}模式。请只为新的模式调整接下来的播放列表，不要回复聊天，不要打断当前播放歌曲。`
      );
      const decision = await this.llmProvider.generateDecision({
        ...context,
        currentMode: mode,
        currentUserInput:
          `用户刚刚通过 UI 手动切换到${label}模式。` +
          "请基于 nowPlaying.currentSong、用户画像和播放反馈，生成 search_and_queue 来更新后续歌单；不要切歌。"
      });

      if (decision.action.type === "search_and_queue") {
        await this.playbackService.playRecommendedQueue(
          decision.action.query,
          decision.action.queueQueries ?? [],
          decision.action.recommendationTuning,
          decision.reason,
          "ai",
          mode
        );
        this.stateService.setLastDecision(decision);
        return;
      }

      await this.playbackService.refreshQueueForMode(mode);
    } catch {
      await this.playbackService.refreshQueueForMode(mode);
    }
  }
}
