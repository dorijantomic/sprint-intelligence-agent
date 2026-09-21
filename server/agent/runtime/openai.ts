import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions/completions";
import type {
  FunctionTool,
  ResponseInput,
} from "openai/resources/responses/responses";
import type {
  AgentConversationItem,
  AgentFunctionTool,
  AgentRuntime,
  AgentTurnRequest,
  AgentTurnResult,
} from "./types.js";

interface OpenAIRuntimeConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

function responseInput(
  conversation: AgentConversationItem[],
): ResponseInput {
  return conversation.map((item) => {
    if (item.role === "user") return { role: "user", content: item.content };
    if (item.role === "tool") {
      return {
        type: "function_call_output",
        call_id: item.toolCallId,
        output: item.content,
      };
    }
    return {
      type: "function_call",
      call_id: item.toolCall.id,
      name: item.toolCall.name,
      arguments: item.toolCall.arguments,
    };
  }) as ResponseInput;
}

function responseTools(tools: AgentFunctionTool[]): FunctionTool[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  }));
}

export class OpenAIResponsesRuntime implements AgentRuntime {
  readonly provider = "openai";
  readonly model: string;
  private readonly client: OpenAI;

  constructor(config: OpenAIRuntimeConfig) {
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: 20_000,
      maxRetries: 1,
    });
  }

  async nextTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
    const response = await this.client.responses.create({
      model: this.model,
      instructions: request.instructions,
      input: responseInput(request.conversation),
      tools: responseTools(request.tools),
      tool_choice: "required",
      parallel_tool_calls: false,
      store: false,
      max_output_tokens: 1200,
    });
    const call = response.output.find((item) => item.type === "function_call");
    if (!call || call.type !== "function_call") {
      throw new Error("Agent did not call a required tool");
    }
    return {
      toolCall: {
        id: call.call_id,
        name: call.name,
        arguments: call.arguments,
      },
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  }
}

function chatMessages(
  instructions: string,
  conversation: AgentConversationItem[],
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: instructions },
  ];
  for (const item of conversation) {
    if (item.role === "user") {
      messages.push({ role: "user", content: item.content });
    } else if (item.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: item.toolCallId,
        content: item.content,
      });
    } else {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: item.toolCall.id,
            type: "function",
            function: {
              name: item.toolCall.name,
              arguments: item.toolCall.arguments,
            },
          },
        ],
      });
    }
  }
  return messages;
}

function chatTools(tools: AgentFunctionTool[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/** Supports services exposing the common OpenAI-compatible Chat Completions protocol. */
export class OpenAICompatibleRuntime implements AgentRuntime {
  readonly provider: string;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(
    config: OpenAIRuntimeConfig & { provider?: string },
  ) {
    this.provider = config.provider ?? "openai-compatible";
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: config.apiKey || "local",
      baseURL: config.baseUrl,
      timeout: 20_000,
      maxRetries: 1,
    });
  }

  async nextTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
    const parameters: ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: chatMessages(request.instructions, request.conversation),
      tools: chatTools(request.tools),
      tool_choice: "required",
      parallel_tool_calls: false,
      max_tokens: 1200,
    };
    const response = await this.client.chat.completions.create(parameters);
    const call = response.choices[0]?.message.tool_calls?.find(
      (candidate) => candidate.type === "function",
    );
    if (!call || call.type !== "function") {
      throw new Error("Agent did not call a required tool");
    }
    return {
      toolCall: {
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      },
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}
