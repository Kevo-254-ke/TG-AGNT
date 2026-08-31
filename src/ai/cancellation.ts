/**
 * Lightweight cancellation primitive. One token per agent execution.
 * The Telegram layer creates it, the controller polls it, and the user
 * cancels it via /stop.
 */
export class CancellationToken {
  private _cancelled = false;
  private _reason: string | null = null;

  cancel(reason = 'user-requested'): void {
    this._cancelled = true;
    this._reason = reason;
  }

  get isCancelled(): boolean {
    return this._cancelled;
  }

  get reason(): string | null {
    return this._reason;
  }

  /** Throws if already cancelled, so the controller can bail early. */
  throwIfCancelled(): void {
    if (this._cancelled) {
      throw new CancellationError(this._reason ?? 'cancelled');
    }
  }
}

export class CancellationError extends Error {
  constructor(reason: string) {
    super(`Execution cancelled: ${reason}`);
    this.name = 'CancellationError';
  }
}
