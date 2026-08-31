import { logger } from '../core/logger';
import type { AIResponse, ChatMessage, ToolCall, ToolExecutionResult } from '../core/types';
import type { ToolRegistry } from '../tools/toolRegistry';
import type { AIFallbackRouter } from './fallbackRouter';
import { ExecutionController } from './executionController';
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
 * Backward-compatible wrapper around ExecutionController.
 * Preserves the exact interface the rest of the codebase expects.
 *
 * @deprecated Prefer ExecutionController directly for new code.
 */
export async function runAgentLoop(deps: AgentLoopDeps, initialMessages: ChatMessage[], userId: string): Promise<AgentRunResult> {
  const controller = new ExecutionController({ ai: deps.ai, tools: deps.tools });
  const result = await controller.run({
    messages: initialMessages,
    userId,
    maxIterations: deps.maxIterations,
    onToolCall: deps.onToolCall,
  });

  return {
    finalContent: result.finalContent,
    steps: result.steps,
    iterations: result.metadata.iterations,
    hitStepLimit: result.terminationReason === 'max_iterations',
  };
}
