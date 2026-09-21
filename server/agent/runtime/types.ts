export interface AgentFunctionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Provider-owned continuation state carried back only to the same runtime. */
  opaque?: unknown;
}

export type AgentConversationItem =
  | { role: "user"; content: string }
  | { role: "assistant"; toolCall: AgentToolCall }
  | { role: "tool"; toolCallId: string; content: string };

export interface AgentTurnRequest {
  instructions: string;
  conversation: AgentConversationItem[];
  tools: AgentFunctionTool[];
}

export interface AgentTurnResult {
  toolCall: AgentToolCall;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * The only contract Orbit's evidence loop requires from an AI agent.
 *
 * Implementations may call a hosted model, a local model, a CLI agent, or a
 * remote agent service. Orbit retains ownership of tool execution and evidence
 * validation; runtimes can request tools but cannot write to the ledger.
 */
export interface AgentRuntime {
  provider: string;
  model: string;
  nextTurn(request: AgentTurnRequest): Promise<AgentTurnResult>;
}

export interface AgentRuntimeFactoryConfig {
  provider: string;
  model: string | null;
  apiKey: string | null;
  baseUrl: string | null;
}

export type AgentRuntimeFactory = (
  config: AgentRuntimeFactoryConfig,
) => AgentRuntime | Promise<AgentRuntime>;
