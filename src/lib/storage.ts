import type { AppUser, StockDecision, StockTransaction } from '../types';

const TX_KEY = 'stock_analyzer_transactions_v1';
const TX_KEY_PREFIX = 'stock_analyzer_transactions_v2';
const DECISIONS_KEY_PREFIX = 'stock_analyzer_decisions_v1';
const USER_KEY = 'stock_analyzer_user_v1';

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function txKey(userId?: string | null): string {
  return `${TX_KEY_PREFIX}:${userId || 'guest'}`;
}

function decisionsKey(userId?: string | null): string {
  return `${DECISIONS_KEY_PREFIX}:${userId || 'guest'}`;
}

export function loadTransactions(userId?: string | null): StockTransaction[] {
  const scoped = safeParse<StockTransaction[] | null>(localStorage.getItem(txKey(userId)), null);
  if (scoped) return scoped;

  // One-time fallback for legacy global storage.
  // If no scoped data exists yet, use the old key so existing users don't lose data.
  return safeParse<StockTransaction[]>(localStorage.getItem(TX_KEY), []);
}

export function saveTransactions(rows: StockTransaction[], userId?: string | null): void {
  localStorage.setItem(txKey(userId), JSON.stringify(rows));
}

export function loadDecisions(userId?: string | null): StockDecision[] {
  return safeParse<StockDecision[]>(localStorage.getItem(decisionsKey(userId)), []);
}

export function saveDecisions(rows: StockDecision[], userId?: string | null): void {
  localStorage.setItem(decisionsKey(userId), JSON.stringify(rows));
}

export function loadUser(): AppUser | null {
  return safeParse<AppUser | null>(localStorage.getItem(USER_KEY), null);
}

export function saveUser(user: AppUser | null): void {
  if (!user) {
    localStorage.removeItem(USER_KEY);
    return;
  }
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
