import {
  DEFAULT_MODERATION_CONFIG,
  type ModerationActionRecord,
  type ModerationConfig,
  parseModerationConfig,
} from "@woofx3/api/moderation-config";
import type { ChatModerationGateway } from "@/engine/gateway";
import type { ChatModerationRead } from "@/engine/types";

/**
 * Chat moderation in memory, for screens and hooks under test. Saves go
 * through the shared parser, as the engine's do, so a test sees the engine's
 * own refusal. `supported: false` answers as an engine too old to moderate.
 */
export class FakeChatModerationGateway implements ChatModerationGateway {
  config: ModerationConfig = DEFAULT_MODERATION_CONFIG;
  actions: ModerationActionRecord[] = [];
  supported = true;
  readonly saved: ModerationConfig[] = [];
  reads = 0;

  private readonly read = async (): Promise<ChatModerationRead> => {
    this.reads++;
    return this.supported ? { kind: "ready", config: this.config } : { kind: "unsupported" };
  };

  private readonly save = async (config: ModerationConfig): Promise<ModerationConfig> => {
    const parsed = parseModerationConfig(config);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    this.config = parsed.value;
    this.saved.push(parsed.value);
    return parsed.value;
  };

  private readonly list = async (limit?: number): Promise<ModerationActionRecord[]> => this.actions.slice(0, limit);

  useConfigRequest = () => this.read;
  useSetConfigRequest = () => this.save;
  useRecentActionsRequest = () => this.list;
}
