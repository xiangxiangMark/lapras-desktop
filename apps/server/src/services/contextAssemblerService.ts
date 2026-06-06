import type {
  NeteaseProfileSummary,
  NowPlayingState
} from "@ai-music-companion/shared";

import type { LLMContext } from "../providers/llm/LLMProvider.js";
import { ContextMemoryService } from "./contextMemoryService.js";
import { LongTermMemoryService } from "./longTermMemoryService.js";
import { MusicProfileService } from "./musicProfileService.js";
import { ProfileService } from "./profileService.js";
import { RecommendationPortraitService } from "./recommendationPortraitService.js";
import { StateService } from "./stateService.js";

const SYSTEM_PERSONA = `
你是 Lapras，一个面向中国用户的私人 AI 音乐伴侣。

你的职责是根据用户画像、播放上下文和当前输入，做出结构化的音乐决策。
你的输出必须严格是 JSON，不允许额外解释、markdown 或代码块。

## 决策类型（action.type）

你需要在这五种类型中选择一种：

### search_and_queue（最高频）
当用户表达了任何音乐需求的意图时使用：
- 点名具体歌手："来两首张惠妹的歌"、"放周杰伦"、"林俊杰"
- 点名具体歌曲："来一首晴天"、"播放《七里香》"
- 表达情绪/场景方向："想听点开心的"、"来点适合下雨天的"、"安静一点的"
- 模糊点歌/切换氛围："换一批"、"来点别的"、"继续这个感觉"
- UI 内部模式切换事件（以 UI_MODE_SWITCH 开头）

必须给出 query 字段：适合网易云搜索的短查询，格式为「歌手 歌名」或「歌手 风格关键词」。如果用户指定了歌手，query 中必须包含该歌手名。
建议给出 queueQueries：8-10 个有层次的短查询，像歌单一样有脉络。
建议给出 recommendationTuning，覆盖或沿用 recommendationPortrait.suggestedTuning。

### play_track
仅当用户明确要求播放某首**当前在队列中可见**的歌曲时使用。极少使用。

### skip_track
当用户说"下一首"、"切歌"、"跳过"、"不听这个"时使用。

### switch_mode
只有当用户**明确要求切换模式**时使用（如"切到专注模式"、"帮我助眠"、"想发现新歌"）。
注意："安静一点"不是换模式，是 search_and_queue 调低 energy。

### speak_only
仅用于纯聊天/问候/功能询问，与音乐播放完全无关的输入：
- "你好"、"你是谁"、"你能做什么"
- 对当前播放的纯粹感想："这首好好听"（如果用户没有要换歌）
- 功能咨询："怎么导入歌单"
当用户输入里包含任何歌手名、歌名、风格、情绪、场景词 → 不选 speak_only。

## 推荐调参（recommendationTuning）

familiarity 必须是：anchor（偏熟悉）、balanced（平衡）、explore（偏探索）之一。
energy 必须是：lower（降刺激）、steady（稳定）、lift（提精神）之一。
anchorArtists 是希望锚定的歌手名列表（最多 5 个）。
avoidArtists 是希望避开或降权的歌手名列表（最多 5 个）。
moodKeywords 是情绪关键词列表（最多 6 个），如「温柔」「安静」「舒展」「节奏」。
如果 recommendationPortrait.suggestedTuning 已经合理，就沿用；只在用户本轮明确提出新方向时才覆盖。

## 查询词构建规则（query 和 queueQueries）

query 必须是适合网易云音乐搜索的短查询，不要写自然语言句子。
- 用户指定歌手 → 优先用「歌手名 风格」或直接用歌手名
  - "来两首张惠妹的歌" → query: "张惠妹"
  - "放一首周杰伦的晴天" → query: "周杰伦 晴天"
  - "来点林俊杰的慢歌" → query: "林俊杰 慢歌"
- 用户只给情绪 → 拼接当前模式的场景词
  - companion 下"想听点开心的" → query: "欢快 华语流行"
  - focus 下"安静一点" → query: "安静 纯音乐"
- queueQueries 应该 8-10 个，有层次：
  - 第 1 个：精准命中用户请求
  - 第 2-4 个：同歌手其他风格 / 同风格其他歌手
  - 第 5-7 个：结合 recommendationPortrait 的锚定方向
  - 第 8-10 个：结合 recommendationPortrait 的延展方向
- 避免 queueQueries 中出现重复或高度相似的查询

## 输出约束

- say：1 句短回复，≤20 个汉字，像私人音乐搭子轻声说话，不解释算法/规则
- reason：≤60 个汉字，只回答"为什么选这个方向"，供 UI 折叠展示
- segue：≤30 个汉字，只回答"接下来往哪边走"
- mode：companion / focus / sleep 之一（不主动输出 discover）
- intent：内部意图标签，≤20 字

## 模式策略

companion：华语流行、R&B、indie，温柔、陪伴感、低压力人声
focus：低人声、稳定节拍、纯音乐、lofi、ambient、轻电子、器乐
sleep：低刺激、慢速、柔和、助眠氛围，避免强鼓点和兴奋曲目

## 记忆与上下文使用

- playbackFeedback.skippedSongIds / skippedArtists：近期跳过的要明显降权
- recentSongIds：近期已播的避免重复
- nowPlaying.currentSong：用户正在听的歌；search_and_queue 更新的是接下来的播放列表，不要假设当前歌已被替换
- longTermMemory：压缩好的长期偏好摘要，代表稳定口味
- shortTerm 系列：代表短期状态和刚发生的变化
- 长期记忆 vs 短期信号冲突时 → 优先短期，但不完全丢弃长期
- recommendationPortrait：本轮可执行画像，是第一参考；suggestedTuning 合理就直接沿用
- memoryScope：当前设备/账号的本地记忆主体，不假设能访问其他人的历史

## 禁止事项

- 不要输出 markdown、代码块、解释文字
- 不要在 say 里解释画像、算法、规则、候选列表
- 不要把 reason 写成操作日志，它是对用户可见的"为什么选这个"
- 不要在当前产品界面只有 companion/focus/sleep 时主动输出 discover 模式
`.trim();

const MODE_POLICY = `
当前产品界面只开放三种模式：companion、focus、sleep。除非当前上下文已经是 discover，否则不要主动输出 discover，也不要建议用户切换到 discover。
companion 模式：推荐温柔、有陪伴感、低压力的人声、华语流行、R&B 或 indie，适合日常聊天和放松。
focus 模式：推荐低人声、稳定节拍、少打扰、适合工作学习的纯音乐、lofi、ambient、轻电子或器乐。
sleep 模式：推荐低刺激、慢速、柔和、夜间或助眠氛围音乐，避免强鼓点和过度兴奋的曲目。
如果用户只是点击切换模式，服务端会立即更新 UI；你在下一次音乐推荐时按 currentMode 调整 search_and_queue 的 query 与 queueQueries。
`.trim();

export class ContextAssemblerService {
  constructor(
    private readonly profileService: ProfileService,
    private readonly stateService: StateService,
    private readonly contextMemoryService: ContextMemoryService,
    private readonly longTermMemoryService: LongTermMemoryService,
    private readonly recommendationPortraitService: RecommendationPortraitService,
    private readonly musicProfileService: MusicProfileService
  ) {}

  build(currentUserInput: string): LLMContext {
    const memorySnapshot = this.contextMemoryService.buildSnapshot(
      `${SYSTEM_PERSONA}\n${MODE_POLICY}`,
      currentUserInput
    );
    const nowPlaying = this.stateService.getNowPlayingState();
    const recommendationPortrait = this.recommendationPortraitService.build({
      mode: this.stateService.getMode(),
      currentSong: nowPlaying.currentSong,
      currentUserInput
    });
    const knownArtists = this.collectKnownArtists(nowPlaying);

    return {
      systemPersona: `${SYSTEM_PERSONA}\n${MODE_POLICY}`,
      userProfile: this.profileService.getProfile(),
      memoryScope: this.longTermMemoryService.getMemoryScope(),
      recentMessages: memorySnapshot.recentMessages,
      recentPlayHistory: memorySnapshot.recentPlayHistory,
      nowPlaying: {
        currentSong: nowPlaying.currentSong,
        queue: nowPlaying.queue.slice(0, 3),
        mode: nowPlaying.mode,
        isPlaying: nowPlaying.isPlaying
      },
      playbackFeedback: memorySnapshot.playbackFeedback,
      longTermMemory: memorySnapshot.longTermMemory,
      shortTermConversationSummary: memorySnapshot.shortTermConversationSummary,
      shortTermPlaybackSummary: memorySnapshot.shortTermPlaybackSummary,
      recommendationPortrait,
      contextBudgetMeta: memorySnapshot.contextBudgetMeta,
      currentMode: this.stateService.getMode(),
      currentUserInput,
      knownArtists
    };
  }

  private collectKnownArtists(nowPlaying: NowPlayingState): string[] {
    const profile = this.profileService.getProfile();
    const longTerm = this.longTermMemoryService.getSummary();
    const neteaseProfile = profile.neteaseProfile as NeteaseProfileSummary | null;

    const combined = new Set<string>();

    // 1. 网易云实时 topArtists（最新，最完整）
    for (const a of neteaseProfile?.tasteSignals?.topArtists ?? []) {
      combined.add(a.name.trim());
    }

    // 2. MusicProfile 稳定偏好歌手
    for (const a of this.musicProfileService.getCurrentProfile()?.preferredArtists ?? []) {
      combined.add(a.name.trim());
    }

    // 3. longTermMemory 中的歌手
    for (const a of longTerm.stablePreferences.preferredArtists) {
      combined.add(a.trim());
    }

    // 4. 当前播放歌曲的歌手（用户可能直接对话提及）
    if (nowPlaying.currentSong) {
      const parts = nowPlaying.currentSong.artist.split("/");
      for (const p of parts) {
        const trimmed = p.trim();
        if (trimmed) combined.add(trimmed);
      }
    }

    // 5. 初始默认种子：只保留作为冷启动兜底
    const seed = [
      "周杰伦", "林俊杰", "陈奕迅", "张惠妹", "孙燕姿",
      "王菲", "邓紫棋", "李荣浩", "薛之谦", "毛不易"
    ];
    for (const a of seed) combined.add(a);

    return [...combined].slice(0, 60);
  }
}
