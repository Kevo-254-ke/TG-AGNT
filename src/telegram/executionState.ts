import { CancellationToken } from '../ai/cancellation';

const activeExecutions = new Map<string, CancellationToken>();

export function getActiveExecution(userId: string): CancellationToken | undefined {
  return activeExecutions.get(userId);
}

export function hasActiveExecution(userId: string): boolean {
  const token = activeExecutions.get(userId);
  return token !== undefined && !token.isCancelled;
}

export function setActiveExecution(userId: string, token: CancellationToken): void {
  activeExecutions.set(userId, token);
}

export function clearActiveExecution(userId: string): void {
  activeExecutions.delete(userId);
}

const PENDING_TTL_MS = 5 * 60 * 1000;

interface PendingDocumentRequest {
  requestedAt: number;
  context?: string;
}

const pendingDocumentRequests = new Map<string, PendingDocumentRequest>();

export function setPendingDocumentRequest(userId: string, context?: string): void {
  pendingDocumentRequests.set(userId, { requestedAt: Date.now(), context });
}

export function clearPendingDocumentRequest(userId: string): void {
  pendingDocumentRequests.delete(userId);
}

export function hasPendingDocumentRequest(userId: string): boolean {
  const pending = pendingDocumentRequests.get(userId);
  if (!pending) return false;
  if (Date.now() - pending.requestedAt > PENDING_TTL_MS) {
    pendingDocumentRequests.delete(userId);
    return false;
  }
  return true;
}

export function getPendingDocumentContext(userId: string): string | undefined {
  return pendingDocumentRequests.get(userId)?.context;
}
