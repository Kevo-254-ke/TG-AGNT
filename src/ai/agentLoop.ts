import { logger } from '../core/logger';
import type { AIResponse, ChatMessage, ToolCall, ToolExecutionResult } from '../core/types';
import type { ToolRegistry } from '../tools/toolRegistry';
import type { AIFallbackRouter } from './fallbackRouter';
import { TOOL_SCHEMAS } from './toolSchemas';

const log = logger.child({ module: 'ai:agentLoop' });

export interface AgentStep {
  toolCall: ToolCall;
  result: ToolExecutionResult;
}

export interface AgentRunResult {
  finalContent: string;
  steps: AgentStep[];
  iterations: number;
  hitStepLimit: boolean;
}

export interface AgentLoopDeps {
  ai: AIFallbackRouter;
  tools: ToolRegistry;
  maxIterations: number;
  /** Called before each tool executes — lets the caller surface live progress (e.g. the Telegram status message). */
  onToolCall?: (toolCall: ToolCall) => Promise<void> | void;
}

/**
 * Runs the OpenAI-style function-calling loop to completion instead of a
 * single request/response round.
 *
 * Without this loop, a request like "make three files" reliably stalls
 * after the first one: many models (especially smaller free-tier ones)
 * emit only one tool call per turn and rely entirely on the caller to
 * report the result and ask "what's next?" — a single ai.chat() call
 * has no way to give the model that second turn. Each iteration here
 * appends the assistant's tool-call request and the corresponding tool
 * result(s) back into the conversation, then asks again, until the model
 * responds with no further tool calls (task done) or `maxIterations` is
 * reached (safety cap against a runaway loop).
 */
export async function runAgentLoop(deps: AgentLoopDeps, initialMessages: ChatMessage[], userId: string): Promise<AgentRunResult> {
  const messages: ChatMessage[] = [...initialMessages];
  const steps: AgentStep[] = [];
  let lastResponse: AIResponse | null = null;

  for (let iteration = 1; iteration <= deps.maxIterations; iteration++) {
    const response = await deps.ai.chat(messages, TOOL_SCHEMAS);
    lastResponse = response;

    if (response.toolCalls.length === 0) {
      return { finalContent: response.content, steps, iterations: iteration, hitStepLimit: false };
    }

    // Echo the model's own tool-call request back into history — the
    // OpenAI-style protocol requires this exact assistant turn to precede
    // the tool result messages, or the follow-up call is malformed.
    messages.push({
      role: 'assistant',
      content: response.content || null,
      tool_calls: response.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    });

    for (const toolCall of response.toolCalls) {
      if (deps.onToolCall) await deps.onToolCall(toolCall);
      const result = await deps.tools.execute(toolCall.name, toolCall.arguments, userId);
      steps.push({ toolCall, result });
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolCall.name,
        content: `${result.success ? 'OK' : 'ERROR'}: ${result.message}`,
      });
    }
  }

  log.warn({ userId, maxIterations: deps.maxIterations }, 'Agent loop hit its step limit without the model finishing');
  return {
    finalContent:
      lastResponse?.content ||
      "I made some progress but hit my step limit for this turn — let me know if you'd like me to keep going.",
    steps,
    iterations: deps.maxIterations,
    hitStepLimit: true,
  };
}
