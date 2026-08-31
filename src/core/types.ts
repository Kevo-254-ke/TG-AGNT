/** A single OpenAI-style tool call as it appears on an assistant message when replayed into history. */
export interface ToolCallRequest {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** A single chat turn in the format every AI provider speaks (OpenAI-style). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  name?: string;
  /** Present on an assistant message that requested tool calls — required so the model sees its own prior request when the conversation is replayed for a follow-up turn. */
  tool_calls?: ToolCallRequest[];
}

/** JSON-schema-ish tool/function definition, shared across providers. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Normalized response shape every AIProvider.chat() resolves to. */
export interface AIResponse {
  content: string;
  toolCalls: ToolCall[];
  provider: string;
  model: string;
  raw?: unknown;
}

export interface AIProvider {
  readonly name: string;
  chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<AIResponse>;
}

export interface StoredUser {
  _id: string;
  telegramId: number;
  name: string;
  createdAt: string;
  lastActiveAt: string;
}

export interface StoredMessage {
  _id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  embedding?: number[] | null;
  tokens: number;
  createdAt: string;
}

export interface StoredSummary {
  _id: string;
  userId: string;
  summary: string;
  messageCount: number;
  embedding?: number[] | null;
  tokens: number;
  dateRangeStart: string;
  dateRangeEnd: string;
  createdAt: string;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number | null;
  embed(text: string): Promise<number[] | null>;
}

export interface BuiltContext {
  messages: ChatMessage[];
  tokenEstimate: number;
  sources: {
    recent: number;
    similar: number;
    summaries: number;
  };
}

export interface ToolExecutionResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export interface ToolHandler {
  name: string;
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolExecutionResult>;
}

// ============================================================
// Execution Controller Types
// ============================================================

export type TerminationReason =
  | 'success'
  | 'max_iterations'
  | 'max_tool_calls_per_step'
  | 'cancelled'
  | 'unrecoverable_error'
  | 'provider_failure';

export interface ToolExecutionRecord {
  toolCall: ToolCall;
  result: ToolExecutionResult;
  durationMs: number;
}

export interface ExecutionMetadata {
  executionId: string;
  userId: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  iterations: number;
  totalToolCalls: number;
  successfulToolCalls: number;
  failedToolCalls: number;
  providerUsed: string;
  modelUsed: string;
  terminationReason: TerminationReason;
  toolRecords: ToolExecutionRecord[];
}

export interface ExecutionResult {
  finalContent: string;
  steps: AgentStep[];
  metadata: ExecutionMetadata;
  terminationReason: TerminationReason;
}

export interface AgentStep {
  toolCall: ToolCall;
  result: ToolExecutionResult;
}
