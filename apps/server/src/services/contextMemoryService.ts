import type {
  ChatMessage,
  PlayRecord
} from "@ai-music-companion/shared";

import type {
  ContextBudgetMeta,
  LongTermMemorySummary,
  ShortTermConversationSummary,
  ShortTermPlaybackSummary
} from "../providers/llm/LLMProvider.js";
import { HistoryService } from "./historyService.js";
import { LongTermMemoryService } from "./longTermMemoryService.js";
import { MessageService } from "./messageService.js";
import { StateService } from "./stateService.js";

type ContextMemorySnapshot = {
  recentMessages: ChatMessage[];
  recentPlayHistory: PlayRecord[];
  playbackFeedback: {
    recentSongIds: string[];
    skippedSongIds: string[];
    skippedArtists: string[];
  };
  longTermMemory: LongTermMemorySummary;
  shortTermConversationSummary: ShortTermConversationSummary;
  shortTermPlaybackSummary: ShortTermPlaybackSummary;
  contextBudgetMeta: ContextBudgetMeta;
};

type WorkingSnapshot = {
  recentMessages: ChatMessage[];
  recentPlayHistory: PlayRecord[];
  longTermMemory: LongTermMemorySummary;
  shortTermConversationSummary: ShortTermConversationSummary;
  shortTermPlaybackSummary: ShortTermPlaybackSummary;
};

export class ContextMemoryService {
  private readonly targetInputTokens = 12000;
  private readonly hardLimitTokens = 20000;
  private readonly segmentBudgets = {
    systemPersona: { targetTokens: 1400, hardChars: 2600 },
    currentInput: { targetTokens: 500, hardChars: 1000 },
    nowPlaying: { targetTokens: 600, hardChars: 1200 },
    recentMessages: { targetTokens: 7000, hardChars: 12600 },
    recentPlayHistory: { targetTokens: 1800, hardChars: 3200 },
    longTermMemory: { targetTokens: 3500, hardChars: 6300 }
  } as const;

  constructor(
    private readonly messageService: MessageService,
    private readonly historyService: HistoryService,
    private readonly longTermMemoryService: LongTermMemoryService,
    private readonly stateService: StateService
  ) {}

  buildSnapshot(systemPersona: string, currentUserInput: string): ContextMemorySnapshot {
    const rawMessages = this.messageService.getRecentMessages(20);
    const rawHistory = this.historyService.getRecentHistory(12);
    const feedbackSignals = this.historyService.getFeedbackSignals(30);
    const nowPlaying = this.stateService.getNowPlayingState();
    const longTermMemory = this.longTermMemoryService.getSummary();
    const snapshot: WorkingSnapshot = {
      recentMessages: this.compactMessages(rawMessages),
      recentPlayHistory: this.compactHistory(rawHistory),
      longTermMemory: this.trimLongTermMemory(longTermMemory),
      shortTermConversationSummary: this.buildConversationSummary(rawMessages),
      shortTermPlaybackSummary: this.buildPlaybackSummary(rawHistory, feedbackSignals.skippedArtists)
    };

    this.enforceBudgets(snapshot, systemPersona, currentUserInput, nowPlaying);

    return {
      recentMessages: snapshot.recentMessages,
      recentPlayHistory: snapshot.recentPlayHistory,
      playbackFeedback: {
        recentSongIds: [...feedbackSignals.recentSongIds].slice(0, 30),
        skippedSongIds: [...feedbackSignals.skippedSongIds].slice(0, 20),
        skippedArtists: [...feedbackSignals.skippedArtists].slice(0, 20)
      },
      longTermMemory: snapshot.longTermMemory,
      shortTermConversationSummary: snapshot.shortTermConversationSummary,
      shortTermPlaybackSummary: snapshot.shortTermPlaybackSummary,
      contextBudgetMeta: this.buildBudgetMeta(
        systemPersona,
        currentUserInput,
        nowPlaying,
        snapshot
      )
    };
  }

  private buildConversationSummary(messages: ChatMessage[]): ShortTermConversationSummary {
    const userMessages = messages.filter((message) => message.role === "user");
    const detectedPreferenceSignals = this.detectPreferenceSignals(userMessages);
    const summaryParts: string[] = [];

    if (userMessages.length > 0) {
      summaryParts.push(
        `最近对话围绕：${userMessages
          .slice(-5)
          .map((message) => this.clampText(message.content, 60))
          .join(" / ")}。`
      );
    }

    if (detectedPreferenceSignals.length > 0) {
      summaryParts.push(`近期偏好信号：${detectedPreferenceSignals.join("、")}。`);
    }

    return {
      summary: summaryParts.join(" "),
      includedMessages: this.compactMessages(messages).slice(-8),
      detectedPreferenceSignals
    };
  }

  private buildPlaybackSummary(
    history: PlayRecord[],
    skippedArtists: Set<string>
  ): ShortTermPlaybackSummary {
    const latestSongs = history
      .slice(0, 3)
      .map((record) => `${record.song.name} - ${record.song.artist}`);
    const feedbackHighlights: string[] = [];

    if (latestSongs.length > 0) {
      feedbackHighlights.push(`最近播放：${latestSongs.join(" / ")}`);
    }

    if (skippedArtists.size > 0) {
      feedbackHighlights.push(
        `近期跳过较多的歌手：${[...skippedArtists].slice(0, 4).join("、")}`
      );
    }

    return {
      summary: feedbackHighlights.join("。"),
      includedHistory: this.compactHistory(history),
      feedbackHighlights
    };
  }

  private enforceBudgets(
    snapshot: WorkingSnapshot,
    systemPersona: string,
    currentUserInput: string,
    nowPlaying: ReturnType<StateService["getNowPlayingState"]>
  ) {
    const hardLimitChars = this.approxCharsFromTokens(this.hardLimitTokens);
    const messageSteps = [16, 12, 8, 4, 2];
    const historySteps = [10, 8, 6, 4];

    while (
      this.calculateUsage(
        systemPersona,
        currentUserInput,
        nowPlaying,
        snapshot
      ).approxChars > hardLimitChars
    ) {
      const nextMessageLimit = messageSteps.find(
        (limit) => snapshot.recentMessages.length > limit
      );
      if (nextMessageLimit) {
        snapshot.recentMessages = snapshot.recentMessages.slice(-nextMessageLimit);
        snapshot.shortTermConversationSummary.includedMessages = snapshot.recentMessages;
        continue;
      }

      const nextHistoryLimit = historySteps.find(
        (limit) => snapshot.recentPlayHistory.length > limit
      );
      if (nextHistoryLimit) {
        snapshot.recentPlayHistory = snapshot.recentPlayHistory.slice(0, nextHistoryLimit);
        snapshot.shortTermPlaybackSummary.includedHistory = snapshot.recentPlayHistory;
        continue;
      }

      snapshot.longTermMemory = this.trimLongTermMemory(snapshot.longTermMemory, {
        artists: 4,
        keywords: 6,
        scenes: 5,
        signals: 3
      });
      break;
    }
  }

  private buildBudgetMeta(
    systemPersona: string,
    currentUserInput: string,
    nowPlaying: ReturnType<StateService["getNowPlayingState"]>,
    snapshot: WorkingSnapshot
  ): ContextBudgetMeta {
    const usage = this.calculateUsage(systemPersona, currentUserInput, nowPlaying, snapshot);

    return {
      targetInputTokens: this.targetInputTokens,
      hardLimitTokens: this.hardLimitTokens,
      segmentBudgets: { ...this.segmentBudgets },
      actualUsage: usage
    };
  }

  private calculateUsage(
    systemPersona: string,
    currentUserInput: string,
    nowPlaying: ReturnType<StateService["getNowPlayingState"]>,
    snapshot: WorkingSnapshot
  ) {
    const approxChars =
      systemPersona.length +
      currentUserInput.length +
      JSON.stringify({
        nowPlaying: {
          currentSong: nowPlaying.currentSong
            ? {
                name: nowPlaying.currentSong.name,
                artist: nowPlaying.currentSong.artist,
                album: nowPlaying.currentSong.album
              }
            : null,
          queue: nowPlaying.queue.slice(0, 3).map((song) => ({
            name: song.name,
            artist: song.artist
          })),
          mode: nowPlaying.mode,
          isPlaying: nowPlaying.isPlaying
        },
        recentMessages: snapshot.recentMessages,
        recentPlayHistory: snapshot.recentPlayHistory,
        longTermMemory: snapshot.longTermMemory,
        shortTermConversationSummary: snapshot.shortTermConversationSummary,
        shortTermPlaybackSummary: snapshot.shortTermPlaybackSummary
      }).length;

    return {
      approxChars,
      approxTokens: this.approxTokensFromChars(approxChars)
    };
  }

  private compactMessages(messages: ChatMessage[]) {
    return messages.slice(-20).map((message) => ({
      ...message,
      content: this.clampText(message.content, 300),
      decision: message.decision
        ? {
            ...message.decision,
            reply: message.decision.reply
              ? {
                  ...message.decision.reply,
                  text: this.clampText(message.decision.reply.text, 240),
                  displayReason: message.decision.reply.displayReason
                    ? this.clampText(message.decision.reply.displayReason, 120)
                    : undefined
                }
              : undefined,
            say: this.clampText(message.decision.say, 120),
            reason: this.clampText(message.decision.reason, 120),
            segue: this.clampText(message.decision.segue, 80)
          }
        : null
    }));
  }

  private compactHistory(history: PlayRecord[]) {
    return history.slice(0, 12).map((record) => ({
      ...record,
      song: {
        id: record.song.id,
        source: record.song.source,
        sourceId: record.song.sourceId,
        name: this.clampText(record.song.name, 48),
        artist: this.clampText(record.song.artist, 40),
        album: record.song.album ? this.clampText(record.song.album, 36) : undefined,
        durationMs: record.song.durationMs,
        coverUrl: record.song.coverUrl
      },
      reason: this.clampText(record.reason, 100)
    }));
  }

  private trimLongTermMemory(
    memory: LongTermMemorySummary,
    limits: {
      artists?: number;
      keywords?: number;
      scenes?: number;
      signals?: number;
    } = {}
  ) {
    const artistLimit = limits.artists ?? 6;
    const keywordLimit = limits.keywords ?? 8;
    const sceneLimit = limits.scenes ?? 6;
    const signalLimit = limits.signals ?? 4;
    const reinforcedSignals = memory.confidence.reinforcedSignals.slice(0, signalLimit);
    const watchSignalBudget = Math.max(signalLimit - reinforcedSignals.length, 0);

    return {
      ...memory,
      sourceSignals: {
        ...memory.sourceSignals,
        preferredArtists: memory.sourceSignals.preferredArtists.slice(0, artistLimit),
        recentAcceptedArtists: memory.sourceSignals.recentAcceptedArtists.slice(0, signalLimit),
        recentSkippedArtists: memory.sourceSignals.recentSkippedArtists.slice(0, signalLimit),
        recentPreferenceSignals: memory.sourceSignals.recentPreferenceSignals.slice(0, signalLimit)
      },
      stablePreferences: {
        ...memory.stablePreferences,
        preferredArtists: memory.stablePreferences.preferredArtists.slice(0, artistLimit),
        preferredKeywords: memory.stablePreferences.preferredKeywords.slice(0, keywordLimit),
        avoidKeywords: memory.stablePreferences.avoidKeywords.slice(0, keywordLimit),
        recurringScenes: memory.stablePreferences.recurringScenes.slice(0, sceneLimit),
        preferredAlbums: memory.stablePreferences.preferredAlbums.slice(0, 4)
      },
      modePreferences: {
        companion: memory.modePreferences.companion.slice(0, 5),
        focus: memory.modePreferences.focus.slice(0, 5),
        sleep: memory.modePreferences.sleep.slice(0, 5)
      },
      recentPreferenceShift: memory.recentPreferenceShift.slice(0, reinforcedSignals.length),
      confidence: {
        ...memory.confidence,
        reinforcedSignals,
        watchSignals: memory.confidence.watchSignals.slice(0, watchSignalBudget),
        updateReasons: memory.confidence.updateReasons.slice(0, 4)
      }
    };
  }

  private detectPreferenceSignals(messages: ChatMessage[]) {
    const labels = new Set<string>();

    for (const message of messages) {
      const content = message.content;

      if (/太吵|安静一点|轻一点|柔和一点|温柔一点|别太炸/i.test(content)) {
        labels.add("希望更柔和");
      }

      if (/熟悉一点|熟一点|别太陌生|不要太新/i.test(content)) {
        labels.add("希望更熟悉");
      }

      if (/继续这个感觉|继续这种感觉|保持这个感觉|保持这个氛围/i.test(content)) {
        labels.add("希望延续当前氛围");
      }

      if (/专注|focus|学习|工作|少人声/i.test(content)) {
        labels.add("在意专注感");
      }

      if (/睡眠|助眠|夜间|晚安/i.test(content)) {
        labels.add("在意夜间舒缓");
      }
    }

    return [...labels].slice(0, 5);
  }

  private clampText(value: string, maxChars: number) {
    const compact = value.replace(/\s+/g, " ").trim();

    if (compact.length <= maxChars) {
      return compact;
    }

    return `${compact.slice(0, maxChars - 1)}…`;
  }

  private approxCharsFromTokens(tokens: number) {
    return Math.round(tokens * 1.8);
  }

  private approxTokensFromChars(chars: number) {
    return Math.ceil(chars / 1.8);
  }
}
