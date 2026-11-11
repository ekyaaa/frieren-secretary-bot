/**
 * Gemini API Key Router with Ordered Failover Pool.
 * Authoritative source: docs/ARCHITECTURE_AND_API.md §6
 *
 * Tries GEMINI_API_KEY_1..N in order for retryable errors (429, 503, timeout).
 * Falls back to encrypted user key when pool is exhausted.
 * Never prints raw keys to logs or traces.
 */

export interface KeyHealth {
  keyId: string;
  healthy: boolean;
  cooldownUntil: number;
}

export type GeminiCaller = (apiKey: string, prompt: string, systemInstruction?: string) => Promise<string>;

export class GeminiKeyRouter {
  private globalKeys: string[];
  private keyHealth: Map<string, KeyHealth> = new Map();
  private cooldownMs: number;

  constructor(globalKeys: string[] = [], cooldownMs: number = 60_000) {
    this.globalKeys = globalKeys.filter((k) => !!k && k.trim().length > 0);
    this.cooldownMs = cooldownMs;

    this.globalKeys.forEach((key, idx) => {
      this.keyHealth.set(`global_key_${idx + 1}`, {
        keyId: `global_key_${idx + 1}`,
        healthy: true,
        cooldownUntil: 0,
      });
    });
  }

  public getGlobalKeysCount(): number {
    return this.globalKeys.length;
  }

  public getKeyHealthSummary(): { keyId: string; healthy: boolean }[] {
    const summary: { keyId: string; healthy: boolean }[] = [];
    const now = Date.now();
    for (const [keyId, health] of this.keyHealth.entries()) {
      summary.push({
        keyId,
        healthy: health.healthy && health.cooldownUntil <= now,
      });
    }
    return summary;
  }

  /**
   * Executes an AI request through key failover:
   * 1. Iterates over healthy global keys in configured order.
   * 2. If all global keys encounter retryable failures, attempts userKey if provided.
   * 3. Throws if all keys fail or on non-retryable error.
   */
  public async executeWithFailover(
    caller: GeminiCaller,
    prompt: string,
    systemInstruction?: string,
    userKey?: string
  ): Promise<{ text: string; usedKeyId: string }> {
    const now = Date.now();
    const errors: string[] = [];

    // 1. Try global keys
    for (let i = 0; i < this.globalKeys.length; i++) {
      const keyId = `global_key_${i + 1}`;
      const health = this.keyHealth.get(keyId);

      if (health && !health.healthy && health.cooldownUntil > now) {
        continue; // skip keys currently on cooldown
      }

      const key = this.globalKeys[i];
      try {
        const text = await caller(key, prompt, systemInstruction);
        // Mark healthy
        this.keyHealth.set(keyId, { keyId, healthy: true, cooldownUntil: 0 });
        return { text, usedKeyId: keyId };
      } catch (err: any) {
        const isRetryable = this.isRetryableError(err);
        errors.push(`[${keyId}] ${err.message || 'unknown error'}`);

        if (isRetryable) {
          // Put key on cooldown
          this.keyHealth.set(keyId, {
            keyId,
            healthy: false,
            cooldownUntil: Date.now() + this.cooldownMs,
          });
          continue; // rotate to next key
        } else {
          // Non-retryable semantic/input error, fail fast without rotating keys
          throw err;
        }
      }
    }

    // 2. Try user key if provided
    if (userKey && userKey.trim().length > 0) {
      try {
        const text = await caller(userKey, prompt, systemInstruction);
        return { text, usedKeyId: 'user_provided_key' };
      } catch (err: any) {
        errors.push(`[user_key] ${err.message || 'unknown error'}`);
        throw new Error(`All Gemini keys failed. Diagnostics: ${errors.join('; ')}`);
      }
    }

    throw new Error(`All global Gemini keys failed and no user key available. Diagnostics: ${errors.join('; ')}`);
  }

  private isRetryableError(err: any): boolean {
    const msg = (err?.message || '').toLowerCase();
    const status = err?.status || err?.statusCode || 0;

    if (status === 429 || status === 503 || status === 500 || status === 504) {
      return true;
    }
    if (msg.includes('429') || msg.includes('quota') || msg.includes('rate limit') || msg.includes('timeout') || msg.includes('econnreset') || msg.includes('503')) {
      return true;
    }
    return false;
  }
}
