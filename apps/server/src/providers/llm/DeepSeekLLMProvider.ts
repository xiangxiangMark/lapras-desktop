import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  LLMDecisionSchema,
  type AppMode,
  type LLMAction,
  type LLMMusicPlan,
  type LLMDecision,
  type RecommendationTuning
} from "@ai-music-companion/shared";

import { config } from "../../config.js";
import type { SettingsService } from "../../services/settingsService.js";
import { extractFirstJsonObject } from "../../utils/json.js";
import type { LLMContext, LLMProvider } from "./LLMProvider.js";

// ============================================================
// 合法枚举值白名单
// ============================================================

const FAMILIARITY_VALUES = ["anchor", "balanced", "explore"] as const;
const ENERGY_VALUES = ["lower", "steady", "lift"] as const;

// ============================================================
// 意图识别类型
// ============================================================

interface ParsedIntent {
  type: "named_artist" | "named_song" | "mood_scene" | "skip" | "mode_switch" | "chat";
  artists?: string[];
  songName?: string;
  moodKeywords?: string[];
  targetMode?: AppMode;
  quantity?: number;
  inputCleaned: string;
}

// ============================================================
// DeepSeekLLMProvider
// ============================================================

export class DeepSeekLLMProvider implements LLMProvider {
  constructor(private readonly settingsService: SettingsService) {}

  async generateDecision(context: LLMContext): Promise<LLMDecision> {
    const settings = this.settingsService.getRuntimeSettings();
    const apiKey = this.settingsService.getDeepseekApiKey();

    if (!apiKey) {
      return this.normalizeDecision(this.buildFallbackDecision(context));
    }

    try {
      const response = await fetch(`${settings.deepseekBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: settings.deepseekModel,
          temperature: 0.6,
          messages: [
            {
              role: "system",
              content: [
                context.systemPersona,
                "Current response protocol overrides any older instruction that says assistant replies must be very short.",
                "Return exactly one JSON object in this shape: { reply: { text, mood?, displayReason? }, intent: { type, confidence }, musicPlan: { action, ... }, mode }.",
                "reply.text is the primary user-facing answer. Write it like a natural ChatGPT-style music companion: conversational, specific, emotionally attentive, and not like a command receipt.",
                "For ordinary conversation, music opinions, memories, emotions, taste discussion, or ambiguous follow-ups, use musicPlan.action='none' and answer naturally. Do not force a recommendation or playback action.",
                "For chat/feedback replies, reply.text may be up to 1000 Chinese characters. Use 1-4 short paragraphs when helpful. For clear play/search/skip/mode commands, keep reply.text concise, usually 20-140 Chinese characters.",
                "Ask at most one light follow-up question when it helps the conversation continue. Avoid generic phrases like '好的' alone; respond to the user's exact words.",
                "Only create a music action when the user clearly asks to play/search/recommend/skip/switch. When musicPlan.action is not 'none', keep the action fields compact and let reply.text remain natural.",
                "Valid intent.type values: chat, music_request, skip, mode_switch, feedback. Valid reply.mood values: soft, playful, quiet, focused.",
                "Valid musicPlan.action values: none, search_and_queue, play_track, skip_track, switch_mode. For search_and_queue include query and optionally queueQueries/tuning.",
                "你必须只输出一个 JSON 对象。禁止输出 markdown、解释、代码块、额外文字。",
                "服务端会基于用户画像、反馈和当前队列做最终选歌排序；你主要负责判断方向、生成简短回复和说明后续走向。",
                "nowPlaying.currentSong 是用户此刻正在听的歌；search_and_queue 只更新接下来的播放列表，不要假设当前歌已被替换。",
                "memoryScope 表示这次请求绑定的本地记忆主体，只属于当前设备上的当前账号或当前本地档案。",
                "如果 currentUserInput 以 UI_MODE_SWITCH 开头，这是界面内部模式切换事件，优先输出 search_and_queue 调整后续队列，say 保持极短。"
              ].join("\n")
            },
            {
              role: "user",
              content: JSON.stringify(
                {
                  memoryScope: context.memoryScope,
                  userProfile: context.userProfile,
                  longTermMemory: context.longTermMemory,
                  shortTermConversationSummary: context.shortTermConversationSummary,
                  shortTermPlaybackSummary: context.shortTermPlaybackSummary,
                  recommendationPortrait: context.recommendationPortrait,
                  recentMessages: context.recentMessages,
                  recentPlayHistory: context.recentPlayHistory,
                  nowPlaying: context.nowPlaying,
                  playbackFeedback: context.playbackFeedback,
                  contextBudgetMeta: context.contextBudgetMeta,
                  currentMode: context.currentMode,
                  currentUserInput: context.currentUserInput
                },
                null,
                2
              )
            }
          ],
          response_format: {
            type: "json_object"
          }
        })
      });

      if (!response.ok) {
        throw new Error(`DeepSeek request failed: ${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | Array<{ text?: string; type?: string }>;
          };
        }>;
      };

      const rawContent = payload.choices?.[0]?.message?.content;
      const contentText = Array.isArray(rawContent)
        ? rawContent
            .map((item) => item.text ?? "")
            .join("")
            .trim()
        : (rawContent ?? "").trim();

      const jsonText = extractFirstJsonObject(contentText);
      const parsedJson = JSON.parse(jsonText) as unknown;
      const decision = this.normalizeDecision(parsedJson);
      const parsed = LLMDecisionSchema.safeParse(decision);

      if (!parsed.success) {
        // 尝试宽松解析：如果基本结构存在，手工修复次要字段
        const rawObj = parsedJson as Record<string, unknown>;
        if (rawObj && typeof rawObj.action === "object" && rawObj.action !== null) {
          const fixed = this.normalizeDecision(rawObj as never);
          this.writeDecisionLog({
            ok: true,
            repaired: true,
            originalError: parsed.error.flatten(),
            decision: fixed,
            raw: contentText,
            input: context.currentUserInput
          });
          return fixed;
        }

        // 基本结构都不对，才真正回退
        this.writeDecisionLog({
          ok: false,
          error: parsed.error.flatten(),
          raw: contentText,
          input: context.currentUserInput
        });
        throw new Error(parsed.error.message);
      }

      const normalizedDecision = parsed.data;

      this.writeDecisionLog({
        ok: true,
        decision: normalizedDecision,
        raw: contentText,
        input: context.currentUserInput
      });

      return normalizedDecision;
    } catch (error) {
      this.writeDecisionLog({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        input: context.currentUserInput,
        fallback: true
      });
      return this.normalizeDecision(this.buildFallbackDecision(context));
    }
  }

  // ============================================================
  // 日志
  // ============================================================

  private writeDecisionLog(entry: unknown) {
    const logDir = config.dataDir;

    try {
      mkdirSync(logDir, { recursive: true });
      appendFileSync(
        path.join(logDir, "llm-decisions.jsonl"),
        `${JSON.stringify({
          at: new Date().toISOString(),
          ...((entry as Record<string, unknown>) ?? {})
        })}\n`,
        "utf8"
      );
    } catch {
      // Logging should never block the music decision path.
    }
  }

  // ============================================================
  // 新 fallback 引擎
  // ============================================================

  private buildFallbackDecision(context: LLMContext): LLMDecision {
    const intent = this.parseIntent(context.currentUserInput.trim(), context.currentMode, context);

    switch (intent.type) {
      case "skip":
        return {
          intent: "skip_current_track",
          say: "这首先跳过。",
          action: { type: "skip_track" },
          reason: "用户要求切歌。",
          segue: "下一首继续贴着当前的氛围走。",
          mode: context.currentMode
        };

      case "mode_switch":
        return this.buildFallbackModeSwitch(intent);

      case "named_artist":
      case "named_song":
      case "mood_scene":
        return this.buildFallbackSearchAndQueue(intent, context);

      case "chat":
      default:
        return {
          intent: "music_companion_reply",
          say: "我在，想听什么直接告诉我。",
          action: { type: "speak_only" },
          reason: "当前输入更像是聊天，先保持陪伴。",
          segue: "你可以直接说歌手名、歌名、或想要的感觉。",
          mode: context.currentMode
        };
    }
  }

  // ---- 意图解析 ----

  private parseIntent(input: string, currentMode: AppMode, context: LLMContext): ParsedIntent {
    // 1. 切歌
    if (/^(下一首|切歌|跳过|skip|next|不听这个|换一首)$/i.test(input)) {
      return { type: "skip", inputCleaned: input };
    }

    // 2. 模式切换
    if (/^(专注模式|focus|工作模式|学习模式|帮我专注|专注一点)/i.test(input)) {
      return { type: "mode_switch", targetMode: "focus", inputCleaned: input };
    }
    if (/^(睡眠|晚安|助眠|sleep|睡觉|睡前)/i.test(input)) {
      return { type: "mode_switch", targetMode: "sleep", inputCleaned: input };
    }
    if (/^(发现|探索|新歌|discover)/i.test(input)) {
      return { type: "mode_switch", targetMode: "companion", inputCleaned: input };
    }

    // 3. 提取数量词
    const quantity = this.extractQuantity(input);

    // 4. 清理命令词
    let cleaned = input
      .replace(/来[一两二三四五六七八九十]?[首个点些曲]|播放|放[一]?[首个]|想听|推荐|给我|帮我/g, " ")
      .replace(/一下|一些|的歌|的歌曲|的歌单|适合|现在/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned.length < 2) {
      cleaned = input;
    }

    // 5. 检测命名歌手
    const namedArtists = this.extractArtistNames(cleaned, context);

    // 6. 检测命名歌曲
    const songName = this.extractSongName(cleaned);

    // 7. 检测情绪/场景关键词
    const moodKeywords = this.extractMoodKeywords(cleaned);

    // 分类
    if (namedArtists.length > 0) {
      return {
        type: "named_artist",
        artists: namedArtists,
        songName: songName ?? undefined,
        moodKeywords: moodKeywords.length > 0 ? moodKeywords : undefined,
        quantity,
        inputCleaned: cleaned
      };
    }

    if (songName) {
      return {
        type: "named_song",
        songName,
        moodKeywords: moodKeywords.length > 0 ? moodKeywords : undefined,
        quantity,
        inputCleaned: cleaned
      };
    }

    if (moodKeywords.length > 0 || cleaned.length >= 4) {
      return {
        type: "mood_scene",
        moodKeywords: moodKeywords.length > 0 ? moodKeywords : [cleaned],
        quantity,
        inputCleaned: cleaned
      };
    }

    return { type: "chat", inputCleaned: cleaned };
  }

  // ---- 数量提取 ----

  private extractQuantity(input: string): number | undefined {
    const map: Record<string, number> = {
      "一": 1, "两": 2, "二": 2,
      "三": 3, "四": 4, "五": 5
    };
    const match = input.match(/([一两二三四五]|[2-5])\s*[首个点些曲]/);
    const key = match?.[1];
    if (key) {
      return map[key] ?? parseInt(key, 10);
    }
    return undefined;
  }

  // ---- 歌手名提取 ----

  private extractArtistNames(cleaned: string, context: LLMContext): string[] {
    const pool = (context.knownArtists ?? []).slice(0, 60);
    // 按名字长度降序排列，避免短名误匹配
    const sorted = [...pool].sort((a, b) => b.length - a.length);
    const matched = sorted.filter((a) => cleaned.toLowerCase().includes(a.toLowerCase()));
    return matched.length > 0 ? matched : [];
  }

  // ---- 歌名提取 ----

  private extractSongName(cleaned: string): string | undefined {
    const bookMatch = cleaned.match(/《([^》]+)》/);
    if (bookMatch) return bookMatch[1];
    return undefined;
  }

  // ---- 情绪关键词提取 ----

  private extractMoodKeywords(cleaned: string): string[] {
    const keywordMap: Record<string, string[]> = {
      // 情绪
      "开心": ["欢快", "流行"],        "难过": ["慢歌", "治愈"],
      "放松": ["chill", "温柔"],       "安静": ["安静", "纯音乐"],
      "温柔": ["温柔", "流行"],        "兴奋": ["节奏", "流行"],
      "伤感": ["慢歌", "情歌"],        "治愈": ["治愈", "温暖"],
      // 场景
      "下雨": ["雨天", "安静"],         "睡前": ["助眠", "夜晚"],
      "工作": ["专注", "纯音乐"],       "学习": ["专注", "lofi"],
      "运动": ["节奏", "电子"],         "开车": ["流行", "节奏"],
      "午后": ["chill", "温柔"],        "夜晚": ["夜晚", "R&B"],
      // 风格
      "摇滚": ["摇滚"],                 "说唱": ["说唱"],
      "民谣": ["民谣"],                 "电子": ["电子"],
      "爵士": ["爵士"],                 "古典": ["古典"],
      "钢琴": ["钢琴", "纯音乐"],
      // 反馈
      "太吵": ["安静"],                 "太慢": ["节奏"],
      "太快": ["慢歌"],                 "熟悉": ["常听"],
      "新鲜": ["新歌"],                 "老歌": ["经典", "怀旧"]
    };

    const found: string[] = [];
    for (const [key, values] of Object.entries(keywordMap)) {
      if (cleaned.includes(key)) {
        found.push(...values);
      }
    }
    return [...new Set(found)];
  }

  // ---- fallback 模式切换 ----

  private buildFallbackModeSwitch(intent: ParsedIntent): LLMDecision {
    const mode = intent.targetMode!;
    const messages: Record<string, { say: string; reason: string; segue: string }> = {
      focus: {
        say: "切到专注，给你收一点。",
        reason: "用户选择了专注模式。",
        segue: "低打扰的纯音乐和 lofi。"
      },
      sleep: {
        say: "切到睡眠，放轻一点。",
        reason: "用户选择了睡眠模式。",
        segue: "慢速柔和的助眠音乐。"
      },
      companion: {
        say: "好，回到陪伴模式。",
        reason: "用户切换到陪伴模式。",
        segue: "温柔的人声和流行。"
      }
    };
    const msg = messages[mode] ?? messages.companion;
    return {
      intent: "switch_mode",
      say: msg!.say,
      action: { type: "switch_mode", nextMode: mode },
      reason: msg!.reason,
      segue: msg!.segue,
      mode
    };
  }

  // ---- fallback search_and_queue 构建 ----

  private buildFallbackSearchAndQueue(
    intent: ParsedIntent,
    context: LLMContext
  ): LLMDecision {
    const query = this.buildSearchQuery(intent, context.currentMode);
    const queueQueries = this.buildFallbackQueueQueries(intent, query, context);
    const tuning = this.buildFallbackTuning(intent, context);

    let say: string;
    if (intent.type === "named_artist" && intent.songName) {
      say = `好，给你放${intent.artists![0]}的《${intent.songName}》。`;
    } else if (intent.type === "named_artist") {
      say = `来，给你接上${intent.artists![0]}的歌。`;
    } else if (intent.type === "named_song") {
      say = `好，我找一下《${intent.songName}》。`;
    } else {
      say = "好，顺着这个感觉给你接。";
    }

    return {
      intent: "recommend_music",
      say,
      action: {
        type: "search_and_queue",
        query,
        queueQueries,
        recommendationTuning: tuning
      },
      reason: context.nowPlaying.currentSong
        ? `根据输入"${intent.inputCleaned}"和当前${context.nowPlaying.currentSong.name}调整方向。`
        : `根据输入"${intent.inputCleaned}"推荐合适曲目。`,
      segue: intent.type === "named_artist"
        ? `接下来围绕${intent.artists![0]}的风格铺开。`
        : "如果方向对了，我会顺着往下接。",
      mode: context.currentMode
    };
  }

  private buildSearchQuery(intent: ParsedIntent, mode: AppMode): string {
    if (intent.type === "named_artist") {
      const artist = intent.artists?.[0] ?? "";
      if (intent.songName) {
        return `${artist} ${intent.songName}`;
      }
      if (intent.moodKeywords && intent.moodKeywords.length > 0) {
        return `${artist} ${intent.moodKeywords.slice(0, 2).join(" ")}`;
      }
      return artist || "华语流行";
    }

    if (intent.type === "named_song") {
      return intent.songName ?? "华语流行";
    }

    const keywords = intent.moodKeywords ?? [intent.inputCleaned];
    const modeHint = this.getModeHint(mode);
    return `${keywords.slice(0, 2).join(" ")} ${modeHint}`;
  }

  private getModeHint(mode: AppMode): string {
    const hints: Record<AppMode, string> = {
      companion: "温柔 陪伴",
      focus: "专注 纯音乐",
      discover: "新鲜 顺滑",
      sleep: "夜晚 轻柔"
    };
    return hints[mode];
  }

  private buildFallbackQueueQueries(
    intent: ParsedIntent,
    primaryQuery: string,
    context: LLMContext
  ): string[] {
    const mode = context.currentMode;
    const modeSeeds: Record<AppMode, string[]> = {
      companion: ["华语 流行 温柔", "R&B 中文 放松", "indie 华语 夜晚", "女声 流行 治愈"],
      focus: ["纯音乐 专注", "lofi chill", "ambient piano", "轻电子 工作"],
      discover: ["华语 indie 温柔", "小众 华语 流行", "城市民谣 放松", "新歌 华语"],
      sleep: ["夜晚 轻柔 助眠", "钢琴 安静", "温柔 女声", "ambient sleep"]
    };

    const base = [primaryQuery];

    // 如果识别到歌手，生成该歌手的多维度查询
    if (intent.type === "named_artist" && intent.artists) {
      for (const artist of intent.artists) {
        base.push(
          `${artist} 热门`,
          `${artist} ${this.getModeHint(mode)}`,
          `${artist} 经典`
        );
      }
    }

    // 情绪关键词衍生
    if (intent.moodKeywords) {
      for (const kw of intent.moodKeywords.slice(0, 3)) {
        base.push(`${kw} ${this.getModeHint(mode)}`);
      }
    }

    // 从 recommendationPortrait 补充
    base.push(
      ...context.recommendationPortrait.anchorQueries.slice(0, 3),
      ...context.recommendationPortrait.exploreQueries.slice(0, 2),
      ...modeSeeds[mode]
    );

    return [...new Set(base.map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean))]
      .slice(0, 10);
  }

  private buildFallbackTuning(
    intent: ParsedIntent,
    context: LLMContext
  ): RecommendationTuning {
    const base = context.recommendationPortrait.suggestedTuning;

    // 用户指定了歌手 → familiarity 偏 anchor
    if (intent.type === "named_artist") {
      return {
        ...base,
        familiarity: "anchor",
        anchorArtists: [
          ...(intent.artists ?? []),
          ...(base.anchorArtists ?? [])
        ].slice(0, 5)
      };
    }

    return base;
  }

  // ============================================================
  // 决策正规化（含枚举容错）
  // ============================================================

  private normalizeDecision(raw: unknown): LLMDecision {
    const obj = this.asRecord(raw) ?? {};
    const rawReply = this.asRecord(obj.reply);
    const rawIntent =
      this.asRecord(obj.intentInfo) ??
      (typeof obj.intent === "object" ? this.asRecord(obj.intent) : undefined);
    const musicPlan = this.normalizeMusicPlan(obj.musicPlan ?? obj.action);
    const action = this.musicPlanToLegacyAction(musicPlan);
    const replyText = this.compactRequiredText(
      rawReply?.text ?? obj.say,
      1000,
      "我在，继续聊。"
    );
    const displayReason = this.compactText(rawReply?.displayReason ?? obj.reason, 180);
    const intentType = this.normalizeIntentType(rawIntent?.type, musicPlan);
    const mode = this.normalizeMode(obj.mode);

    return {
      reply: {
        text: replyText,
        mood: this.normalizeReplyMood(rawReply?.mood),
        ...(displayReason ? { displayReason } : {})
      },
      intentInfo: {
        type: intentType,
        confidence: this.normalizeConfidence(rawIntent?.confidence)
      },
      musicPlan,
      intent: this.compactRequiredText(
        typeof obj.intent === "string" ? obj.intent : intentType,
        40,
        intentType
      ),
      say: this.compactRequiredText(obj.say ?? replyText, 240, replyText),
      action,
      reason: this.compactRequiredText(
        obj.reason ?? displayReason,
        84,
        "根据你的输入继续调整当前推荐。"
      ),
      segue: this.compactRequiredText(obj.segue, 42, "继续按这个方向听。"),
      mode
    };
  }

  private normalizeLegacyDecision(decision: LLMDecision): LLMDecision {
    const normalizedAction =
      decision.action.type === "search_and_queue"
        ? {
            ...decision.action,
            recommendationTuning: this.normalizeTuning(decision.action.recommendationTuning)
          }
        : decision.action;

    return {
      ...decision,
      action: normalizedAction,
      intent: this.compactRequiredText(decision.intent, 40, "继续聊天"),
      say: this.compactRequiredText(decision.say, 24, "我在，继续说。"),
      reason: this.compactRequiredText(
        decision.reason,
        84,
        "根据你的输入继续调整当前推荐。"
      ),
      segue: this.compactRequiredText(decision.segue, 42, "继续按这个方向听。")
    };
  }

  private normalizeMusicPlan(raw: unknown): LLMMusicPlan {
    const obj = this.asRecord(raw);

    if (!obj) {
      return { action: "none" };
    }

    const action = typeof obj.action === "string"
      ? obj.action
      : typeof obj.type === "string"
        ? obj.type
        : "none";

    switch (action) {
      case "search_and_queue":
        return {
          action: "search_and_queue",
          query: this.compactRequiredText(obj.query, 80, "华语 流行"),
          queueQueries: Array.isArray(obj.queueQueries)
            ? obj.queueQueries
                .map((value) => this.compactText(value, 80))
                .filter(Boolean)
                .slice(0, 10)
            : undefined,
          tuning: this.normalizeTuning(obj.tuning ?? obj.recommendationTuning)
        };
      case "play_track":
        if (!this.compactText(obj.songId, 80)) {
          return { action: "none" };
        }
        return {
          action: "play_track",
          songId: this.compactRequiredText(obj.songId, 80, "")
        };
      case "skip_track":
        return { action: "skip_track" };
      case "switch_mode":
        return {
          action: "switch_mode",
          nextMode: this.normalizeMode(obj.nextMode)
        };
      case "none":
      case "speak_only":
      default:
        return { action: "none" };
    }
  }

  private musicPlanToLegacyAction(plan: LLMMusicPlan): LLMAction {
    switch (plan.action) {
      case "search_and_queue":
        return {
          type: "search_and_queue",
          query: plan.query,
          queueQueries: plan.queueQueries,
          recommendationTuning: plan.tuning
        };
      case "play_track":
        return { type: "play_track", songId: plan.songId };
      case "skip_track":
        return { type: "skip_track" };
      case "switch_mode":
        return { type: "switch_mode", nextMode: plan.nextMode };
      case "none":
      default:
        return { type: "speak_only" };
    }
  }

  private normalizeIntentType(raw: unknown, plan: LLMMusicPlan) {
    if (
      raw === "chat" ||
      raw === "music_request" ||
      raw === "skip" ||
      raw === "mode_switch" ||
      raw === "feedback"
    ) {
      return raw;
    }

    switch (plan.action) {
      case "search_and_queue":
      case "play_track":
        return "music_request";
      case "skip_track":
        return "skip";
      case "switch_mode":
        return "mode_switch";
      case "none":
      default:
        return "chat";
    }
  }

  private normalizeReplyMood(raw: unknown) {
    return raw === "playful" || raw === "quiet" || raw === "focused" ? raw : "soft";
  }

  private normalizeConfidence(raw: unknown) {
    return typeof raw === "number" && Number.isFinite(raw)
      ? Math.min(1, Math.max(0, raw))
      : 0.7;
  }

  private normalizeMode(raw: unknown): AppMode {
    return raw === "focus" || raw === "sleep" || raw === "discover" || raw === "companion"
      ? raw
      : "companion";
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private normalizeTuning(raw: unknown): RecommendationTuning | undefined {
    if (!raw || typeof raw !== "object") return undefined;

    const obj = raw as Record<string, unknown>;

    // familiarity 容错：错值 → "balanced"
    let familiarity: RecommendationTuning["familiarity"] = "balanced";
    if (typeof obj.familiarity === "string") {
      const lower = obj.familiarity.toLowerCase();
      if ((FAMILIARITY_VALUES as ReadonlyArray<string>).includes(lower)) {
        familiarity = lower as RecommendationTuning["familiarity"];
      } else if (["familiar", "known", "same"].includes(lower)) {
        familiarity = "anchor";
      } else if (["new", "fresh", "novel"].includes(lower)) {
        familiarity = "explore";
      }
    }

    // energy 容错：错值 → "steady"
    let energy: RecommendationTuning["energy"] = "steady";
    if (typeof obj.energy === "string") {
      const lower = obj.energy.toLowerCase();
      if ((ENERGY_VALUES as ReadonlyArray<string>).includes(lower)) {
        energy = lower as RecommendationTuning["energy"];
      } else if (["low", "calm", "quiet", "soft"].includes(lower)) {
        energy = "lower";
      } else if (["high", "up", "excited"].includes(lower)) {
        energy = "lift";
      }
    }

    return {
      familiarity,
      energy,
      anchorArtists: (Array.isArray(obj.anchorArtists) ? obj.anchorArtists : [])
        .map((a: string) => this.compactText(a, 20))
        .slice(0, 5),
      avoidArtists: (Array.isArray(obj.avoidArtists) ? obj.avoidArtists : [])
        .map((a: string) => this.compactText(a, 20))
        .slice(0, 5),
      moodKeywords: (Array.isArray(obj.moodKeywords) ? obj.moodKeywords : [])
        .map((k: string) => this.compactText(k, 16))
        .slice(0, 6)
    };
  }

  // ============================================================
  // 工具函数
  // ============================================================

  private compactRequiredText(value: unknown, maxLength: number, fallback: string) {
    const compacted = this.compactText(value, maxLength);
    return compacted || this.compactText(fallback, maxLength);
  }

  private compactText(value: unknown, maxLength: number) {
    const compacted = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

    if (compacted.length <= maxLength) {
      return compacted;
    }

    return `${compacted.slice(0, maxLength - 1)}…`;
  }
}
