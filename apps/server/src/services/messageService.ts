import type { ChatMessage, ChatRole, LLMDecision } from "@ai-music-companion/shared";

import type { DatabaseClient } from "../db/sqlite.js";
import { createId } from "../utils/id.js";
import { safeJsonParse } from "../utils/json.js";
import { MemoryScopeService } from "./memoryScopeService.js";

interface MessageRow {
  id: string;
  memory_scope_key?: string | null;
  role: ChatRole;
  content: string;
  decision_json: string | null;
  created_at: string;
}

export class MessageService {
  constructor(
    private readonly db: DatabaseClient,
    private readonly getProfileId: () => string = () => "default",
    private readonly memoryScopeService?: MemoryScopeService
  ) {}

  createMessage(role: ChatRole, content: string, decision?: LLMDecision | null): ChatMessage {
    const scope = this.memoryScopeService?.getMemoryScope();
    const message: ChatMessage = {
      id: createId(),
      role,
      content,
      createdAt: new Date().toISOString(),
      decision: decision ?? null
    };

    this.db
      .prepare(
        `
          INSERT INTO messages (
            id,
            profile_id,
            memory_scope_key,
            netease_user_id,
            role,
            content,
            decision_json,
            created_at
          )
          VALUES (@id, @profile_id, @memory_scope_key, @netease_user_id, @role, @content, @decision_json, @created_at)
        `
      )
      .run({
        id: message.id,
        profile_id: this.getProfileId(),
        memory_scope_key: scope?.key ?? null,
        netease_user_id: scope?.neteaseUserId ?? null,
        role: message.role,
        content: message.content,
        decision_json: message.decision ? JSON.stringify(message.decision) : null,
        created_at: message.createdAt
      });

    return message;
  }

  getRecentMessages(limit = 8): ChatMessage[] {
    const scope = this.memoryScopeService?.getMemoryScope();
    const rows = this.db
      .prepare(
        `
          SELECT id, memory_scope_key, role, content, decision_json, created_at
          FROM messages
          WHERE profile_id = ?
          ORDER BY datetime(created_at) DESC
          LIMIT ?
        `
      )
      .all([this.getProfileId(), Math.max(limit * 4, 24)]) as MessageRow[];

    return rows
      .filter((row) => {
        if (!scope) {
          return true;
        }

        if (scope.source === "profile") {
          return !row.memory_scope_key || row.memory_scope_key === scope.key;
        }

        return row.memory_scope_key === scope.key;
      })
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: row.created_at,
        decision: safeJsonParse(row.decision_json, null)
      }))
      .reverse();
  }

  getLatestUserMessage() {
    const messages = this.getRecentMessages(8);
    return [...messages].reverse().find((message) => message.role === "user") ?? null;
  }
}
