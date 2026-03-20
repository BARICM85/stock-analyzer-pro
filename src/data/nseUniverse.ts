import type { UniverseStock } from '../types';

const sectors = ['Banking', 'IT', 'FMCG', 'Auto', 'Energy', 'Pharma', 'Infra', 'Metals', 'Telecom'];

const known = [
  'RELIANCE','TCS','INFY','HDFCBANK','ICICIBANK','SBIN','LT','ITC','HINDUNILVR','BHARTIARTL',
  'AXISBANK','KOTAKBANK','BAJFINANCE','ASIANPAINT','MARUTI','TITAN','SUNPHARMA','ULTRACEMCO','WIPRO','ADANIPORTS',
];

function buildOne(symbol: string, idx: number): UniverseStock {
  return {
    symbol,
    name: `${symbol} Limited`,
    exchange: 'NSE',
    sector: sectors[idx % sectors.length],
    pe: Number((8 + (idx % 55) + Math.random()).toFixed(2)),
    rsi: Number((20 + (idx % 60) + Math.random()).toFixed(2)),
    volume: 100000 + idx * 3250,
    price: Number((80 + (idx % 3200) + Math.random() * 3).toFixed(2)),
  };
}

export function getNseUniverse(): UniverseStock[] {
  const rows: UniverseStock[] = [];

  known.forEach((s, i) => rows.push(buildOne(s, i)));

  for (let i = known.length; i < 2200; i += 1) {
    const symbol = `NSE${String(i).padStart(4, '0')}`;
    rows.push(buildOne(symbol, i));
  }

  return rows;
}
