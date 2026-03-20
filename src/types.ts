export type TradeType = 'buy' | 'sell';

export interface StockTransaction {
  id: string;
  date: string;
  scriptName: string;
  exchange: 'NSE' | 'BSE';
  quantity: number;
  price: number;
  type: TradeType;
}

export interface Holding {
  symbol: string;
  exchange: 'NSE' | 'BSE';
  quantity: number;
  avgCost: number;
  marketPrice: number;
  value: number;
  pnl: number;
  pnlPct: number;
}

export interface UniverseStock {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  sector: string;
  pe: number;
  rsi: number;
  volume: number;
  price: number;
}

export interface BacktestPoint {
  date: string;
  equity: number;
}

export interface OptimizationResult {
  weights: Array<{ symbol: string; weight: number }>;
  sharpe: number;
  expectedReturn: number;
  risk: number;
}

export interface AppUser {
  uid: string;
  displayName: string;
  email?: string;
  provider: 'google' | 'local';
}

export interface StockDecision {
  id: string;
  symbol: string;
  thesis: string;
  targetPrice: number;
  stopLoss: number;
  confidence: number; // 0-100
  horizon: 'swing' | 'positional' | 'longterm';
  status: 'active' | 'hit_target' | 'stopped' | 'invalidated';
  closedPrice?: number;
  closedAt?: string;
  reviewScore?: number; // 0-100
  createdAt: string;
  updatedAt: string;
}
