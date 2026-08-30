import axios, { AxiosInstance } from 'axios';
import { env } from '../../config/env';
import { logger } from '../../core/logger';
import type { AIProvider, AIResponse, ChatMessage, ToolCall, ToolDefinition } from '../../core/types';

const log = logger.child({ module: 'ai:openrouter' });

/**
 * OpenRouter client. OpenRouter proxies many free/cheap models behind one
 * OpenAI-compatible endpoint, so this doubles as a template for adding
 * more OpenAI-compatible providers later — only baseURL/model/env differ.
 */
export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter';
  private readonly client: AxiosInstance;

  constructor(private readonly apiKey: string, private readonly model: string) {
    this.client = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: env.AI_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://kevoloves.dev',
        'X-Title': 'Telegram Coding Agent',
      },
    });
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<AIResponse> {
    if (!this.isConfigured) {
      throw new Error('OpenRouter is not configured (missing OPENROUTER_API_KEY)');
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: env.AI_TEMPERATURE,
      max_tokens: env.AI_MAX_TOKENS,
    };
    if (tools?.length) {
      payload.tools = tools;
      payload.tool_choice = 'auto';
    }

    try {
      const { data } = await this.client.post('/chat/completions', payload);
      const choice = data?.choices?.[0]?.message;
      if (!choice) throw new Error('OpenRouter returned no message choice');

      const toolCalls: ToolCall[] = (choice.tool_calls ?? []).map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: safeJsonParse(tc.function?.arguments),
      }));

      return {
        content: choice.content ?? '',
        toolCalls,
        provider: this.name,
        model: this.model,
        raw: data,
      };
    } catch (err) {
      log.warn({ err: describeAxiosError(err) }, 'OpenRouter request failed');
      throw err;
    }
  }
}

function safeJsonParse(input: unknown): Record<string, unknown> {
  if (typeof input !== 'string') return {};
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

export function describeAxiosError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return `${err.response?.status ?? 'no-status'} ${err.response?.data ? JSON.stringify(err.response.data).slice(0, 200) : err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
