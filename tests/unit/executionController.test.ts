import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionController } from '../../src/ai/executionController';
import { AIFallbackRouter } from '../../src/ai/fallbackRouter';
import { ToolRegistry } from '../../src/tools/toolRegistry';
import { CancellationToken } from '../../src/ai/cancellation';
import type { AIProvider, AIResponse, ChatMessage } from '../../src/core/types';

function toolCallResponse(id: string, name: string, args: Record<string, unknown>): AIResponse {
  return { content: '', toolCalls: [{ id, name, arguments: args }], provider: 'fake', model: 'fake' };
}

function finalResponse(content: string): AIResponse {
  return { content, toolCalls: [], provider: 'fake', model: 'fake' };
}

describe('ExecutionController', () => {
  let filesDir: string;
  let tools: ToolRegistry;
  const userId = 'user-1';

  beforeEach(async () => {
    filesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'exec-ctrl-test-'));
    tools = new ToolRegistry(filesDir);
  });

  afterEach(async () => {
    await fs.rm(filesDir, { recursive: true, force: true });
  });

  it('completes successfully when model returns no tool calls', async () => {
    const chat = vi.fn(async () => finalResponse('Hello!'));
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const controller = new ExecutionController({ ai, tools });

    const result = await controller.run({ messages: [{ role: 'user', content: 'hi' }], userId });

    expect(result.terminationReason).toBe('success');
    expect(result.finalContent).toBe('Hello!');
    expect(result.metadata.iterations).toBe(1);
    expect(result.metadata.totalToolCalls).toBe(0);
    expect(result.metadata.providerUsed).toBe('fake');
  });

  it('executes tools and continues until no more tool calls', async () => {
    let call = 0;
    const chat = vi.fn(async (): Promise<AIResponse> => {
      call += 1;
      if (call === 1) return toolCallResponse('1', 'create_file', { filename: 'a.txt', content: 'hello' });
      if (call === 2) return toolCallResponse('2', 'create_file', { filename: 'b.txt', content: 'world' });
      return finalResponse('Done!');
    });
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const controller = new ExecutionController({ ai, tools });

    const result = await controller.run({ messages: [{ role: 'user', content: 'make two files' }], userId });

    expect(result.terminationReason).toBe('success');
    expect(result.metadata.iterations).toBe(3);
    expect(result.metadata.totalToolCalls).toBe(2);
    expect(result.metadata.successfulToolCalls).toBe(2);
    expect(result.metadata.failedToolCalls).toBe(0);
    expect(result.steps).toHaveLength(2);
  });

  it('respects max iteration limit', async () => {
    const chat = vi.fn(async (): Promise<AIResponse> =>
      toolCallResponse('x', 'create_file', { filename: 'loop.txt', content: 'x' }),
    );
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const controller = new ExecutionController({ ai, tools });

    const result = await controller.run({
      messages: [{ role: 'user', content: 'go' }],
      userId,
      maxIterations: 3,
    });

    expect(result.terminationReason).toBe('max_iterations');
    expect(result.metadata.iterations).toBe(3);
    expect(result.metadata.totalToolCalls).toBe(3);
  });

  it('respects max tool calls per step', async () => {
    const chat = vi.fn(async (): Promise<AIResponse> => ({
      content: '',
      toolCalls: Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        name: 'create_file',
        arguments: { filename: `${i}.txt`, content: 'x' },
      })),
      provider: 'fake',
      model: 'fake',
    }));
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const controller = new ExecutionController({ ai, tools });

    const result = await controller.run({
      messages: [{ role: 'user', content: 'make many files' }],
      userId,
      maxToolCallsPerStep: 2,
    });

    expect(result.terminationReason).toBe('max_tool_calls_per_step');
    expect(result.metadata.totalToolCalls).toBe(0);
  });

  it('times out hanging tools and returns error to model', async () => {
    const slowTools = {
      execute: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100_000));
        return { success: true, message: 'done' };
      }),
    } as unknown as ToolRegistry;

    const chat = vi.fn(async (): Promise<AIResponse> => {
      return toolCallResponse('1', 'create_file', { filename: 'a.txt', content: 'x' });
    });
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const controller = new ExecutionController({ ai, tools: slowTools });

    const result = await controller.run({
      messages: [{ role: 'user', content: 'go' }],
      userId,
      toolTimeoutMs: 100,
    });

    expect(result.terminationReason).toBe('success');
    expect(result.steps[0].result.success).toBe(false);
    expect(result.steps[0].result.message).toContain('timed out');
  });

  it('supports cancellation via CancellationToken', async () => {
    let call = 0;
    const chat = vi.fn(async (): Promise<AIResponse> => {
      call += 1;
      if (call === 1) return toolCallResponse('1', 'create_file', { filename: 'a.txt', content: 'x' });
      return toolCallResponse('2', 'create_file', { filename: 'b.txt', content: 'y' });
    });
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const controller = new ExecutionController({ ai, tools });
    const token = new CancellationToken();

    setTimeout(() => token.cancel('user-requested'), 50);

    const result = await controller.run({
      messages: [{ role: 'user', content: 'make files' }],
      userId,
      cancellationToken: token,
    });

    expect(result.terminationReason).toBe('cancelled');
    expect(result.finalContent).toContain('stopped');
  });

  it('returns structured metadata with executionId and duration', async () => {
    const chat = vi.fn(async () => finalResponse('Done'));
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const controller = new ExecutionController({ ai, tools });

    const result = await controller.run({ messages: [{ role: 'user', content: 'hi' }], userId });

    expect(result.metadata.executionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.metadata.userId).toBe(userId);
    expect(result.metadata.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metadata.startTime).toBeDefined();
    expect(result.metadata.endTime).toBeDefined();
  });

  it('falls back to provider_failure when all providers fail', async () => {
    const chat = vi.fn(async () => {
      throw new Error('network error');
    });
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const controller = new ExecutionController({ ai, tools });

    const result = await controller.run({ messages: [{ role: 'user', content: 'hi' }], userId });

    expect(result.terminationReason).toBe('provider_failure');
    expect(result.finalContent).toContain('problem');
  });

  it('calls onToolCall before each tool execution', async () => {
    let call = 0;
    const chat = vi.fn(async (): Promise<AIResponse> => {
      call += 1;
      if (call === 1) return toolCallResponse('1', 'create_file', { filename: 'a.txt', content: 'a' });
      return finalResponse('done');
    });
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const controller = new ExecutionController({ ai, tools });
    const onToolCall = vi.fn();

    await controller.run({
      messages: [{ role: 'user', content: 'make a file' }],
      userId,
      onToolCall,
    });

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith(expect.objectContaining({ name: 'create_file' }));
  });

  it('handles multiple tool calls in one response', async () => {
    const chat = vi.fn(async (): Promise<AIResponse> => ({
      content: '',
      toolCalls: [
        { id: '1', name: 'create_file', arguments: { filename: 'a.txt', content: 'a' } },
        { id: '2', name: 'create_file', arguments: { filename: 'b.txt', content: 'b' } },
      ],
      provider: 'fake',
      model: 'fake',
    }));
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const controller = new ExecutionController({ ai, tools });

    const result = await controller.run({ messages: [{ role: 'user', content: 'make two files' }], userId });

    expect(result.metadata.totalToolCalls).toBe(2);
    expect(result.metadata.successfulToolCalls).toBe(2);
    expect(result.steps).toHaveLength(2);
  });

  it('allows model to recover from failed tools by returning error as observation', async () => {
    let call = 0;
    const chat = vi.fn(async (messages: ChatMessage[]): Promise<AIResponse> => {
      call += 1;
      if (call === 1) return toolCallResponse('1', 'read_file', { filename: 'nonexistent.txt' });
      const toolMsg = messages.find((m) => m.role === 'tool');
      expect(toolMsg?.content).toContain('ERROR');
      return finalResponse('That file does not exist.');
    });
    const ai = new AIFallbackRouter([{ name: 'fake', chat } as unknown as AIProvider]);
    const controller = new ExecutionController({ ai, tools });

    const result = await controller.run({ messages: [{ role: 'user', content: 'read missing file' }], userId });

    expect(result.terminationReason).toBe('success');
    expect(result.steps[0].result.success).toBe(false);
    expect(result.finalContent).toContain('does not exist');
  });
});
