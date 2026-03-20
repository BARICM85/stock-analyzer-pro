import * as XLSX from 'xlsx';
import Papa, { type ParseResult } from 'papaparse';
import type { StockTransaction, TradeType } from '../types';

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseTradeType(raw: unknown): TradeType {
  const text = String(raw ?? '').toLowerCase();
  if (text.includes('sell') || text.includes('-')) return 'sell';
  return 'buy';
}

function normalizeSymbol(raw: unknown): string {
  let text = String(raw ?? '').toUpperCase().trim();
  if (!text) return '';

  if (text.includes(':')) {
    text = text.split(':').pop() || text;
  }

  text = text.replace(/\.NS$|\.BO$/g, '');
  text = text.replace(/-EQ$/g, '');
  text = text.split(/\s+/)[0];
  text = text.replace(/[^A-Z0-9]/g, '');
  return text;
}

function toTransaction(row: Record<string, unknown>, idx: number): StockTransaction | null {
  const keys = Object.keys(row);
  const keyMap = new Map(keys.map((k) => [norm(k), k]));

  const dateKey = keyMap.get('date');
  const scriptKey = keyMap.get('scriptname') ?? keyMap.get('symbol');
  const exchangeKey = keyMap.get('exchange');
  const qtyKey = keyMap.get('quantity');
  const priceKey = keyMap.get('price') ?? keyMap.get('shareprice');
  const typeKey = keyMap.get('typebuysell') ?? keyMap.get('type');

  if (!scriptKey || !qtyKey || !priceKey) return null;

  const date = dateKey ? String(row[dateKey] ?? '').slice(0, 10) : new Date().toISOString().slice(0, 10);
  const scriptName = normalizeSymbol(row[scriptKey]);
  if (!scriptName) return null;

  const quantity = Number(row[qtyKey]);
  const price = Number(row[priceKey]);
  if (!Number.isFinite(quantity) || !Number.isFinite(price) || quantity <= 0 || price <= 0) return null;

  const exchangeRaw = String(exchangeKey ? row[exchangeKey] : 'NSE').toUpperCase();
  const exchange = exchangeRaw.includes('BSE') ? 'BSE' : 'NSE';

  return {
    id: `${Date.now()}_${idx}_${scriptName}`,
    date: date || new Date().toISOString().slice(0, 10),
    scriptName,
    exchange,
    quantity,
    price,
    type: parseTradeType(typeKey ? row[typeKey] : 'buy'),
  };
}

export async function parseUpload(file: File): Promise<StockTransaction[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    const text = await file.text();
    const parsed: ParseResult<Record<string, unknown>> = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
    });
    return parsed.data
      .map((row: Record<string, unknown>, i: number) => toTransaction(row, i))
      .filter((x: StockTransaction | null): x is StockTransaction => Boolean(x));
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    return rows
      .map((row: Record<string, unknown>, i: number) => toTransaction(row, i))
      .filter((x: StockTransaction | null): x is StockTransaction => Boolean(x));
  }

  throw new Error('Unsupported file type. Please upload CSV or XLSX.');
}
