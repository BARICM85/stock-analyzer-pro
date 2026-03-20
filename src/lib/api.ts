import type { BacktestPoint, OptimizationResult, StockTransaction } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export interface LiveUniverseStock {
  symbol: string;
  name: string;
  exchange: string;
}

export interface LiveOptionRow {
  strike: number;
  call?: { ltp?: number | null; oi?: number | null; volume?: number | null; iv?: number | null } | null;
  put?: { ltp?: number | null; oi?: number | null; volume?: number | null; iv?: number | null } | null;
}

export interface BrokerPosition {
  symbol: string;
  exchange: 'NSE' | 'BSE';
  quantity: number;
  avg_price: number;
  ltp?: number | null;
}

export interface BrokerSyncResponse {
  source: string;
  broker: string;
  imported_count: number;
  positions: BrokerPosition[];
  transactions: ApiTransaction[];
}

export interface IntegrationCapabilities {
  brokers: Array<'demo' | 'zerodha' | 'upstox' | 'angelone' | 'icici'>;
  mf_sources: Array<'auto' | 'nsdl' | 'cdsl'>;
  mode: 'simulated' | 'hybrid' | 'live';
  notes: string;
}

export interface OAuthStartResponse {
  broker: 'zerodha' | 'upstox' | 'angelone' | 'icici';
  mode: 'simulated' | 'hybrid' | 'live';
  auth_url: string;
  state: string;
  configured: boolean;
}

export interface BrokerOAuthStatusResponse {
  broker: 'zerodha' | 'upstox' | 'angelone' | 'icici';
  connected: boolean;
  mode: 'simulated' | 'hybrid' | 'live';
  token_source?: string | null;
  expires_at?: string | null;
  updated_at?: string | null;
}

interface ApiTransaction {
  id: string;
  user_id: string;
  date: string;
  script_name: string;
  exchange: 'NSE' | 'BSE';
  quantity: number;
  price: number;
  side: 'buy' | 'sell';
}

function toStockTransaction(row: ApiTransaction): StockTransaction {
  return {
    id: row.id,
    date: row.date,
    scriptName: row.script_name,
    exchange: row.exchange,
    quantity: row.quantity,
    price: row.price,
    type: row.side,
  };
}

function toApiTransaction(userId: string, row: StockTransaction): ApiTransaction {
  return {
    id: row.id,
    user_id: userId,
    date: row.date,
    script_name: row.scriptName,
    exchange: row.exchange,
    quantity: row.quantity,
    price: row.price,
    side: row.type,
  };
}

export async function syncUniverse(): Promise<{ synced: number }> {
  const r = await fetch(`${API_BASE}/market/universe/sync`, { method: 'POST' });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchUniverse(limit = 500, offset = 0): Promise<LiveUniverseStock[]> {
  const r = await fetch(`${API_BASE}/market/universe?limit=${limit}&offset=${offset}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchOptions(symbol: string): Promise<{ symbol: string; spot?: number; expiry?: string; source?: string; rows: LiveOptionRow[] }> {
  const r = await fetch(`${API_BASE}/market/options/${encodeURIComponent(symbol)}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchQuote(
  symbol: string,
  exchange = 'NSE',
): Promise<{ price: number; prev_close?: number; change_pct?: number; source?: string; as_of?: string }> {
  const r = await fetch(`${API_BASE}/market/quote/${encodeURIComponent(symbol)}?exchange=${exchange}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function optimizePortfolioLive(symbols: string[], exchange = 'NSE'): Promise<OptimizationResult> {
  const r = await fetch(`${API_BASE}/quant/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols, exchange, lookback_days: 252, risk_free_rate: 0.06 }),
  });
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  return {
    weights: data.weights,
    expectedReturn: data.expected_return,
    risk: data.risk,
    sharpe: data.sharpe,
  };
}

export async function backtestLive(symbols: string[], startDate: string, endDate: string, exchange = 'NSE'): Promise<BacktestPoint[]> {
  const r = await fetch(`${API_BASE}/quant/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbols, exchange, start_date: startDate, end_date: endDate }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function fetchTransactions(userId: string): Promise<StockTransaction[]> {
  const r = await fetch(`${API_BASE}/portfolio/transactions?user_id=${encodeURIComponent(userId)}`);
  if (!r.ok) throw new Error(await r.text());
  const rows = (await r.json()) as ApiTransaction[];
  return rows.map(toStockTransaction);
}

export async function upsertTransaction(userId: string, row: StockTransaction): Promise<StockTransaction> {
  const r = await fetch(`${API_BASE}/portfolio/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toApiTransaction(userId, row)),
  });
  if (!r.ok) throw new Error(await r.text());
  return toStockTransaction((await r.json()) as ApiTransaction);
}

export async function deleteTransactionRemote(userId: string, txId: string): Promise<void> {
  const r = await fetch(
    `${API_BASE}/portfolio/transactions/${encodeURIComponent(txId)}?user_id=${encodeURIComponent(userId)}`,
    {
    method: 'DELETE',
    },
  );
  if (!r.ok) throw new Error(await r.text());
}

export async function syncBrokerPortfolio(
  userId: string,
  broker: 'demo' | 'zerodha' | 'upstox' | 'angelone' | 'icici' = 'demo',
): Promise<BrokerSyncResponse> {
  const r = await fetch(`${API_BASE}/integrations/broker/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, broker, import_to_portfolio: true }),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as BrokerSyncResponse;
}

export async function fetchIntegrationCapabilities(): Promise<IntegrationCapabilities> {
  const r = await fetch(`${API_BASE}/integrations/capabilities`);
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as IntegrationCapabilities;
}

export async function startBrokerOAuth(
  userId: string,
  broker: 'zerodha' | 'upstox' | 'angelone' | 'icici',
): Promise<OAuthStartResponse> {
  const r = await fetch(
    `${API_BASE}/integrations/oauth/${encodeURIComponent(broker)}/start?user_id=${encodeURIComponent(userId)}`,
  );
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as OAuthStartResponse;
}

export async function fetchBrokerOAuthStatus(
  userId: string,
  broker: 'zerodha' | 'upstox' | 'angelone' | 'icici',
): Promise<BrokerOAuthStatusResponse> {
  const r = await fetch(
    `${API_BASE}/integrations/oauth/${encodeURIComponent(broker)}/status?user_id=${encodeURIComponent(userId)}`,
  );
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as BrokerOAuthStatusResponse;
}

export async function disconnectBrokerOAuth(
  userId: string,
  broker: 'zerodha' | 'upstox' | 'angelone' | 'icici',
): Promise<void> {
  const r = await fetch(
    `${API_BASE}/integrations/oauth/${encodeURIComponent(broker)}/disconnect?user_id=${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
  if (!r.ok) throw new Error(await r.text());
}
