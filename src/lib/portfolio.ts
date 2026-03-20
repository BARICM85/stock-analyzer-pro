import type { BacktestPoint, Holding, OptimizationResult, StockTransaction } from '../types';

function hashSymbol(symbol: string): number {
  return [...symbol.toUpperCase()].reduce((a, c) => a + c.charCodeAt(0), 0);
}

export function buildHoldings(transactions: StockTransaction[]): Holding[] {
  const map = new Map<string, { qty: number; cost: number; exchange: 'NSE' | 'BSE' }>();

  for (const tx of transactions) {
    const key = tx.scriptName.toUpperCase();
    const prev = map.get(key) ?? { qty: 0, cost: 0, exchange: tx.exchange };
    if (tx.type === 'buy') {
      prev.cost += tx.quantity * tx.price;
      prev.qty += tx.quantity;
    } else {
      const sellQty = Math.min(prev.qty, tx.quantity);
      const avg = prev.qty > 0 ? prev.cost / prev.qty : 0;
      prev.qty -= sellQty;
      prev.cost -= sellQty * avg;
    }
    prev.exchange = tx.exchange;
    map.set(key, prev);
  }

  const holdings: Holding[] = [];
  for (const [symbol, row] of map.entries()) {
    if (row.qty <= 0) continue;
    const avgCost = row.cost / row.qty;
    // In non-live mode, use avg cost as baseline market to avoid misleading synthetic quotes.
    const marketPrice = Number(avgCost.toFixed(2));
    const value = row.qty * marketPrice;
    const pnl = value - row.qty * avgCost;
    const pnlPct = avgCost > 0 ? ((marketPrice - avgCost) / avgCost) * 100 : 0;
    holdings.push({
      symbol,
      exchange: row.exchange,
      quantity: Number(row.qty.toFixed(2)),
      avgCost: Number(avgCost.toFixed(2)),
      marketPrice,
      value: Number(value.toFixed(2)),
      pnl: Number(pnl.toFixed(2)),
      pnlPct: Number(pnlPct.toFixed(2)),
    });
  }

  return holdings.sort((a, b) => b.value - a.value);
}

export function runBacktest(transactions: StockTransaction[], initial = 100000): BacktestPoint[] {
  if (transactions.length === 0) {
    return [{ date: new Date().toISOString().slice(0, 10), equity: initial }];
  }

  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const points: BacktestPoint[] = [];
  let equity = initial;

  for (let i = 0; i < sorted.length; i += 1) {
    const tx = sorted[i];
    const signal = tx.type === 'buy' ? 1 : -1;
    const impact = (hashSymbol(tx.scriptName) % 17) / 100;
    const move = signal * tx.quantity * tx.price * impact * 0.01;
    equity += move;
    points.push({ date: tx.date, equity: Number(equity.toFixed(2)) });
  }

  return points;
}

export function optimizePortfolio(holdings: Holding[], riskFreeRate = 0.06): OptimizationResult {
  if (holdings.length === 0) {
    return { weights: [], sharpe: 0, expectedReturn: 0, risk: 0 };
  }

  const scores = holdings.map((h) => {
    const expected = 0.08 + ((hashSymbol(h.symbol) % 16) / 100);
    const vol = 0.12 + ((hashSymbol(h.symbol + 'v') % 18) / 100);
    const sharpe = (expected - riskFreeRate) / vol;
    return { symbol: h.symbol, expected, vol, sharpe, raw: Math.max(sharpe, 0.05) };
  });

  const totalRaw = scores.reduce((s, x) => s + x.raw, 0);
  const weights = scores.map((s) => ({ symbol: s.symbol, weight: Number(((s.raw / totalRaw) * 100).toFixed(2)) }));

  const expectedReturn = scores.reduce((acc, s, i) => acc + (weights[i].weight / 100) * s.expected, 0);
  const risk = scores.reduce((acc, s, i) => acc + (weights[i].weight / 100) * s.vol, 0);
  const sharpe = risk > 0 ? (expectedReturn - riskFreeRate) / risk : 0;

  return {
    weights,
    sharpe: Number(sharpe.toFixed(3)),
    expectedReturn: Number((expectedReturn * 100).toFixed(2)),
    risk: Number((risk * 100).toFixed(2)),
  };
}
