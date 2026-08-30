import { describe, expect, it, vi } from 'vitest';
import { AIFallbackRouter } from '../../src/ai/fallbackRouter';
import type { AIProvider, ChatMessage } from '../../src/core/types';

function fakeProvider(name: string, impl: () => Promise<any>): AIProvider {
  return { name, chat: vi.fn(impl) } as unknown as AIProvider;
}

const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];

describe('AIFallbackRouter', () => {
  it('returns the first provider response when it succeeds', async () => {
    const primary = fakeProvider('primary', async () => ({
      content: 'from primary',
      toolCalls: [],
      provider: 'primary',
      model: 'x',
    }));
    const secondary = fakeProvider('secondary', async () => {
      throw new Error('should not be called');
    });

    const router = new AIFallbackRouter([primary, secondary]);
    const result = await router.chat(messages);

    expect(result.content).toBe('from primary');
    expect(primary.chat).toHaveBeenCalledTimes(1);
    expect(secondary.chat).not.toHaveBeenCalled();
  });

  it('falls back to the next provider on failure', async () => {
    const primary = fakeProvider('primary', async () => {
      throw new Error('primary down');
    });
    const secondary = fakeProvider('secondary', async () => ({
      content: 'from secondary',
      toolCalls: [],
      provider: 'secondary',
      model: 'x',
    }));

    const router = new AIFallbackRouter([primary, secondary]);
    const result = await router.chat(messages);

    expect(result.content).toBe('from secondary');
  });

  it('returns a degraded response when every provider fails', async () => {
    const primary = fakeProvider('primary', async () => {
      throw new Error('down');
    });
    const secondary = fakeProvider('secondary', async () => {
      throw new Error('also down');
    });

    const router = new AIFallbackRouter([primary, secondary]);
    const result = await router.chat(messages);

    expect(result.provider).toBe('degraded');
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('opens the circuit after repeated failures and skips the provider', async () => {
    let calls = 0;
    const flaky = fakeProvider('flaky', async () => {
      calls += 1;
      throw new Error('down');
    });
    const backup = fakeProvider('backup', async () => ({
      content: 'backup ok',
      toolCalls: [],
      provider: 'backup',
      model: 'x',
    }));

    const router = new AIFallbackRouter([flaky, backup]);

    // 3 failures trips the breaker (threshold hardcoded at 3 in the router)
    await router.chat(messages);
    await router.chat(messages);
    await router.chat(messages);
    expect(calls).toBe(3);

    // Next call should skip `flaky` entirely since its circuit is open
    await router.chat(messages);
    expect(calls).toBe(3); // unchanged — flaky was skipped

    const health = router.getHealth();
    expect(health.flaky.available).toBe(false);
    expect(health.backup.available).toBe(true);
  });

  it('reports healthy providers via getHealth before any failures', () => {
    const a = fakeProvider('a', async () => ({ content: '', toolCalls: [], provider: 'a', model: 'x' }));
    const router = new AIFallbackRouter([a]);
    expect(router.getHealth()).toEqual({ a: { available: true } });
  });
});
