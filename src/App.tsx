import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AuthProvider } from './lib/auth';
import {
  backtestLive,
  disconnectBrokerOAuth,
  deleteTransactionRemote,
  fetchBrokerOAuthStatus,
  fetchIntegrationCapabilities,
  fetchOptions,
  fetchQuote,
  fetchTransactions,
  fetchUniverse,
  optimizePortfolioLive,
  startBrokerOAuth,
  syncBrokerPortfolio,
  syncUniverse,
  upsertTransaction,
} from './lib/api';
import { buildHoldings, optimizePortfolio, runBacktest } from './lib/portfolio';
import { loadDecisions, loadTransactions, saveDecisions, saveTransactions } from './lib/storage';
import { useAuth } from './lib/use-auth';
import { parseUpload } from './lib/upload';
import { getNseUniverse } from './data/nseUniverse';
import type { StockDecision, StockTransaction } from './types';

const tabs = ['Prototype', 'Dashboard', 'Portfolio', 'Screener', 'Options', 'Backtest', 'Optimizer', 'Decisions'] as const;
type Tab = (typeof tabs)[number];

const SYMBOL_ALIASES: Record<string, string> = {
  RELAINCE: 'RELIANCE',
  REC: 'RECLTD',
};

function normalizeDisplaySymbol(symbol: string): string {
  const first = symbol.toUpperCase().trim().split(/\s+/)[0];
  return first.replace(/\.NS$|\.BO$|-EQ$/g, '').replace(/[^A-Z0-9]/g, '');
}

function normalizeInputSymbol(symbol: string): string {
  const normalized = normalizeDisplaySymbol(symbol);
  return SYMBOL_ALIASES[normalized] ?? normalized;
}

function AppBody() {
  const { user, loginWithGoogle, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'Dashboard';
    const saved = window.localStorage.getItem('stock_analyzer_active_tab');
    return (tabs as readonly string[]).includes(saved || '') ? (saved as Tab) : 'Dashboard';
  });
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [form, setForm] = useState({ date: '', scriptName: '', exchange: 'NSE', quantity: '', price: '', type: 'buy' });
  const [scriptSuggestOpen, setScriptSuggestOpen] = useState(false);
  const [scriptSuggestIndex, setScriptSuggestIndex] = useState(-1);
  const [search, setSearch] = useState('');
  const [peRange, setPeRange] = useState({ min: 0, max: 100 });
  const [rsiRange, setRsiRange] = useState({ min: 0, max: 100 });
  const [minVolume, setMinVolume] = useState(0);
  const [liveMode, setLiveMode] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');

  const [liveUniverse, setLiveUniverse] = useState<Array<{ symbol: string; name: string; exchange: string }>>([]);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [liveQuoteMeta, setLiveQuoteMeta] = useState<Record<string, { source: string; asOf: string; prevClose?: number; changePct?: number }>>({});
  const [holdingsSort, setHoldingsSort] = useState<'symbol' | 'profit_desc' | 'profit_asc' | 'day_desc' | 'day_asc'>('symbol');
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [editHoldingForm, setEditHoldingForm] = useState<{ quantity: string; avgCost: string; exchange: 'NSE' | 'BSE' }>({
    quantity: '',
    avgCost: '',
    exchange: 'NSE',
  });
  const [optionsRows, setOptionsRows] = useState<Array<{ strike: number; callLtp: number; putLtp: number; iv: number; oi: number }>>([]);
  const [optionsMeta, setOptionsMeta] = useState<{ spot?: number; expiry?: string }>({});
  const [optionsSource, setOptionsSource] = useState<'mock' | 'live_nse' | 'fallback'>('mock');
  const [equityDataLive, setEquityDataLive] = useState<Array<{ date: string; equity: number }>>([]);
  const [optimizerLive, setOptimizerLive] = useState<{ weights: Array<{ symbol: string; weight: number }>; expectedReturn: number; risk: number; sharpe: number } | null>(null);
  const [range, setRange] = useState({ start: '2024-01-01', end: new Date().toISOString().slice(0, 10) });
  const [decisions, setDecisions] = useState<StockDecision[]>([]);
  const [alerts, setAlerts] = useState<Array<{ id: string; symbol: string; kind: 'target' | 'stop'; message: string; at: string }>>([]);
  const [alertLastFired, setAlertLastFired] = useState<Record<string, string>>({});
  const [autoCloseOnAlert, setAutoCloseOnAlert] = useState(true);
  const [browserNotify, setBrowserNotify] = useState(false);
  const [soundNotify, setSoundNotify] = useState(false);
  const [alertCooldownMins, setAlertCooldownMins] = useState(15);
  const [riskLimits, setRiskLimits] = useState({
    maxPositionPct: 25,
    maxSectorPct: 45,
    maxDailyLoss: 5000,
  });
  const [decisionForm, setDecisionForm] = useState({
    symbol: '',
    thesis: '',
    targetPrice: '',
    stopLoss: '',
    confidence: '60',
    horizon: 'swing' as 'swing' | 'positional' | 'longterm',
  });
  const [brokerChoice, setBrokerChoice] = useState<'demo' | 'zerodha' | 'upstox' | 'angelone' | 'icici'>('demo');
  const [brokerImportedCount, setBrokerImportedCount] = useState(0);
  const [integrationMode, setIntegrationMode] = useState('simulated');
  const [brokerConnected, setBrokerConnected] = useState(false);
  const [brokerStatusLabel, setBrokerStatusLabel] = useState('Not connected');
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const txSyncVersionRef = useRef(0);
  const shouldUseRemoteTx = Boolean(user?.uid && user?.provider === 'google');

  const holdingsBase = useMemo(() => buildHoldings(transactions), [transactions]);

  const holdings = useMemo(() => {
    if (!liveMode) return holdingsBase;
    return holdingsBase.map((h) => {
      const price = livePrices[h.symbol] ?? h.marketPrice;
      const value = price * h.quantity;
      const pnl = value - h.quantity * h.avgCost;
      const pnlPct = h.avgCost > 0 ? ((price - h.avgCost) / h.avgCost) * 100 : 0;
      return { ...h, marketPrice: price, value, pnl, pnlPct };
    });
  }, [holdingsBase, liveMode, livePrices]);

  const universe = useMemo(() => {
    if (liveMode && liveUniverse.length > 0) {
      return liveUniverse.map((x, i) => ({
        symbol: x.symbol,
        name: x.name,
        exchange: x.exchange === 'BSE' ? 'BSE' as const : 'NSE' as const,
        sector: ['Banking', 'IT', 'FMCG', 'Auto', 'Energy'][i % 5],
        pe: 8 + (i % 55),
        rsi: 25 + (i % 55),
        volume: 100000 + i * 1200,
        price: livePrices[x.symbol] ?? (80 + (i % 2100)),
      }));
    }
    return getNseUniverse();
  }, [liveMode, liveUniverse, livePrices]);

  useEffect(() => {
    if (!liveMode) return;
    (async () => {
      try {
        setLiveStatus('Syncing NSE universe...');
        await syncUniverse();
        const rows = await fetchUniverse(2000, 0);
        setLiveUniverse(rows);
        setLiveStatus(`Live mode active: ${rows.length} symbols loaded`);
      } catch (err) {
        setLiveStatus(`Live mode error: ${String(err)}`);
      }
    })();
  }, [liveMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('stock_analyzer_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const oauthDone = url.searchParams.get('oauth_done');
    const tabParam = url.searchParams.get('tab');
    const broker = url.searchParams.get('broker');
    if (oauthDone === '1') {
      if (tabParam && (tabs as readonly string[]).includes(tabParam)) {
        setActiveTab(tabParam as Tab);
      } else {
        setActiveTab('Portfolio');
      }
      if (broker) setLiveStatus(`OAuth connected for ${broker}. You can sync broker now.`);
      url.searchParams.delete('oauth_done');
      url.searchParams.delete('broker');
      url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const caps = await fetchIntegrationCapabilities();
        setIntegrationMode(caps.mode);
      } catch {
        // best-effort optional metadata
      }
    })();
  }, []);

  useEffect(() => {
    if (!user?.uid || brokerChoice === 'demo') {
      setBrokerConnected(brokerChoice === 'demo');
      setBrokerStatusLabel(brokerChoice === 'demo' ? 'No OAuth required' : 'Login required');
      return;
    }
    (async () => {
      try {
        const status = await fetchBrokerOAuthStatus(
          user.uid,
          brokerChoice as 'zerodha' | 'upstox' | 'angelone' | 'icici',
        );
        setBrokerConnected(status.connected);
        if (!status.connected) {
          setBrokerStatusLabel('Not connected');
          return;
        }
        const expires = status.expires_at ? new Date(status.expires_at).toLocaleString('en-IN') : 'N/A';
        setBrokerStatusLabel(`Connected (${status.token_source || 'token'}) exp: ${expires}`);
      } catch {
        setBrokerConnected(false);
        setBrokerStatusLabel('Status unavailable');
      }
    })();
  }, [brokerChoice, user?.uid]);

  useEffect(() => {
    function onOAuthDone(event: MessageEvent) {
      if (!event?.data || event.data.type !== 'broker_oauth_done') return;
      if (!user?.uid || brokerChoice === 'demo') return;
      void (async () => {
        try {
          const status = await fetchBrokerOAuthStatus(
            user.uid,
            brokerChoice as 'zerodha' | 'upstox' | 'angelone' | 'icici',
          );
          setBrokerConnected(status.connected);
          const expires = status.expires_at ? new Date(status.expires_at).toLocaleString('en-IN') : 'N/A';
          setBrokerStatusLabel(status.connected ? `Connected (${status.token_source || 'token'}) exp: ${expires}` : 'Not connected');
          setLiveStatus(`OAuth connected for ${brokerChoice}. You can sync broker now.`);
        } catch {
          setLiveStatus('OAuth callback received, but status refresh failed.');
        }
      })();
    }
    if (typeof window !== 'undefined') window.addEventListener('message', onOAuthDone);
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('message', onOAuthDone);
    };
  }, [brokerChoice, user?.uid]);

  useEffect(() => {
    let cancelled = false;
    const version = ++txSyncVersionRef.current;

    (async () => {
      const localTx = loadTransactions(user?.uid);
      const localDecisions = loadDecisions(user?.uid);
      setDecisions(localDecisions);

      if (!shouldUseRemoteTx || !user?.uid) {
        setTransactions(localTx);
        return;
      }

      try {
        setLiveStatus('Loading cloud portfolio...');
        const remoteTx = await fetchTransactions(user.uid);
        if (cancelled || version !== txSyncVersionRef.current) return;

        if (remoteTx.length > 0 || localTx.length === 0) {
          setTransactions(remoteTx);
          saveTransactions(remoteTx, user.uid);
          setLiveStatus(`Cloud portfolio loaded (${remoteTx.length} transactions)`);
          return;
        }

        await Promise.all(localTx.map((tx) => upsertTransaction(user.uid, tx)));
        if (cancelled || version !== txSyncVersionRef.current) return;
        setTransactions(localTx);
        setLiveStatus(`Cloud portfolio initialized (${localTx.length} transactions)`);
      } catch (err) {
        if (cancelled || version !== txSyncVersionRef.current) return;
        setTransactions(localTx);
        setLiveStatus(`Cloud sync unavailable, using local data: ${String(err).slice(0, 120)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldUseRemoteTx, user?.uid]);

  const screenerRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    return universe
      .filter((x) => (!q ? true : x.symbol.includes(q) || x.name.toUpperCase().includes(q)))
      .filter((x) => x.pe >= peRange.min && x.pe <= peRange.max)
      .filter((x) => x.rsi >= rsiRange.min && x.rsi <= rsiRange.max)
      .filter((x) => x.volume >= minVolume)
      .slice(0, 150);
  }, [universe, search, peRange, rsiRange, minVolume]);

  const manualScriptSuggestions = useMemo(() => {
    const query = normalizeInputSymbol(form.scriptName);
    if (!query) return [];

    const rows = universe
      .filter((x) => x.symbol.includes(query) || x.name.toUpperCase().includes(query))
      .sort((a, b) => {
        const aStarts = a.symbol.startsWith(query) ? 0 : 1;
        const bStarts = b.symbol.startsWith(query) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.symbol.localeCompare(b.symbol);
      });

    const seen = new Set<string>();
    const out: Array<{ symbol: string; name: string; exchange: 'NSE' | 'BSE' }> = [];
    for (const row of rows) {
      const symbol = normalizeInputSymbol(row.symbol);
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      out.push({ symbol, name: row.name, exchange: row.exchange === 'BSE' ? 'BSE' : 'NSE' });
      if (out.length >= 8) break;
    }
    return out;
  }, [form.scriptName, universe]);

  const allocationData = holdings.map((h) => ({ name: h.symbol, value: h.value }));
  const pnlData = holdings.map((h) => ({ symbol: h.symbol, pnl: h.pnl }));
  const equityDataLocal = runBacktest(transactions);
  const optimizationLocal = optimizePortfolio(holdings);

  const summary = useMemo(() => {
    const total = holdings.reduce((s, h) => s + h.value, 0);
    const invested = holdings.reduce((s, h) => s + h.quantity * h.avgCost, 0);
    const pnl = total - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    return { total, invested, pnl, pnlPct };
  }, [holdings]);

  const holdingsWithMetrics = useMemo(() => {
    return holdings.map((h) => {
      const m = liveQuoteMeta[h.symbol];
      const prevClose = m?.prevClose;
      const dayPnl = prevClose && prevClose > 0 ? (h.marketPrice - prevClose) * h.quantity : null;
      const dayPnlPct = prevClose && prevClose > 0 ? ((h.marketPrice - prevClose) / prevClose) * 100 : null;
      return { ...h, dayPnl, dayPnlPct };
    });
  }, [holdings, liveQuoteMeta]);

  const holdingsSorted = useMemo(() => {
    const rows = [...holdingsWithMetrics];
    switch (holdingsSort) {
      case 'profit_desc':
        return rows.sort((a, b) => b.pnl - a.pnl);
      case 'profit_asc':
        return rows.sort((a, b) => a.pnl - b.pnl);
      case 'day_desc':
        return rows.sort((a, b) => (b.dayPnl ?? -Infinity) - (a.dayPnl ?? -Infinity));
      case 'day_asc':
        return rows.sort((a, b) => (a.dayPnl ?? Infinity) - (b.dayPnl ?? Infinity));
      default:
        return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
  }, [holdingsWithMetrics, holdingsSort]);

  const overallDayPnl = useMemo(() => {
    return holdingsWithMetrics.reduce((s, h) => s + (h.dayPnl ?? 0), 0);
  }, [holdingsWithMetrics]);

  const highestProfit = useMemo(() => {
    if (holdingsWithMetrics.length === 0) return null;
    return [...holdingsWithMetrics].sort((a, b) => b.pnl - a.pnl)[0];
  }, [holdingsWithMetrics]);

  const highestLoss = useMemo(() => {
    if (holdingsWithMetrics.length === 0) return null;
    return [...holdingsWithMetrics].sort((a, b) => a.pnl - b.pnl)[0];
  }, [holdingsWithMetrics]);

  async function syncTransactionsRemote(next: StockTransaction[], prev: StockTransaction[], version: number) {
    if (!shouldUseRemoteTx || !user?.uid) return;

    const nextIds = new Set(next.map((tx) => tx.id));
    const removedIds = prev.filter((tx) => !nextIds.has(tx.id)).map((tx) => tx.id);
    try {
      await Promise.all([
        ...next.map((tx) => upsertTransaction(user.uid, tx)),
        ...removedIds.map((id) => deleteTransactionRemote(user.uid, id)),
      ]);
      if (version === txSyncVersionRef.current) {
        setLiveStatus(`Cloud portfolio synced (${next.length} transactions)`);
      }
    } catch (err) {
      if (version === txSyncVersionRef.current) {
        setLiveStatus(`Cloud transaction sync failed: ${String(err).slice(0, 120)}`);
      }
    }
  }

  function updateTx(next: StockTransaction[]) {
    const prev = transactions;
    const version = ++txSyncVersionRef.current;
    setTransactions(next);
    saveTransactions(next, user?.uid);
    void syncTransactionsRemote(next, prev, version);
  }

  function updateDecisions(next: StockDecision[]) {
    setDecisions(next);
    saveDecisions(next, user?.uid);
  }

  function addDecision(e: React.FormEvent) {
    e.preventDefault();
    const symbol = normalizeInputSymbol(decisionForm.symbol);
    const targetPrice = Number(decisionForm.targetPrice);
    const stopLoss = Number(decisionForm.stopLoss);
    const confidence = Number(decisionForm.confidence);
    if (!symbol || !decisionForm.thesis.trim()) return;
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) return;
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) return;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) return;

    const now = new Date().toISOString();
    const row: StockDecision = {
      id: `dec_${Date.now()}_${symbol}`,
      symbol,
      thesis: decisionForm.thesis.trim(),
      targetPrice,
      stopLoss,
      confidence,
      horizon: decisionForm.horizon,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    updateDecisions([row, ...decisions]);
    setDecisionForm({
      symbol: '',
      thesis: '',
      targetPrice: '',
      stopLoss: '',
      confidence: '60',
      horizon: 'swing',
    });
    setLiveStatus(`Decision added: ${symbol}`);
  }

  function deleteDecision(id: string) {
    updateDecisions(decisions.filter((d) => d.id !== id));
  }

  function computeDecisionReviewScore(
    d: StockDecision,
    status: StockDecision['status'],
    closedPrice?: number,
  ): number {
    const outcomeScore = status === 'hit_target' ? 50 : status === 'stopped' ? 15 : status === 'invalidated' ? 25 : 35;
    const rr = d.stopLoss > 0 ? (d.targetPrice - d.stopLoss) / d.stopLoss : 0;
    const disciplineScore = rr >= 0.08 ? 30 : rr >= 0.04 ? 20 : 10;

    const holding = holdingsBase.find((h) => normalizeInputSymbol(h.symbol) === normalizeInputSymbol(d.symbol));
    const entry = holding?.avgCost;
    let entryScore = 10;
    if (entry && entry > 0 && closedPrice && Number.isFinite(closedPrice)) {
      const movePct = ((closedPrice - entry) / entry) * 100;
      if (status === 'hit_target') entryScore = movePct >= 2 ? 20 : 14;
      else if (status === 'stopped') entryScore = movePct <= -2 ? 18 : 12;
      else entryScore = 12;
    }

    return Math.max(0, Math.min(100, Math.round(outcomeScore + disciplineScore + entryScore)));
  }

  function setDecisionStatus(id: string, status: StockDecision['status'], closedPrice?: number) {
    const now = new Date().toISOString();
    updateDecisions(
      decisions.map((d) => {
        if (d.id !== id) return d;
        if (status === 'active') {
          return { ...d, status, updatedAt: now, closedAt: undefined, closedPrice: undefined, reviewScore: undefined };
        }
        const score = computeDecisionReviewScore(d, status, closedPrice);
        return { ...d, status, updatedAt: now, closedAt: now, closedPrice, reviewScore: score };
      }),
    );
  }

  function symbolCandidates(symbol: string): string[] {
    const base = symbol.toUpperCase().trim();
    const noSuffix = base.replace(/\.NS$|\.BO$|-EQ$/g, '');
    const first = noSuffix.split(/\s+/)[0].replace(/[^A-Z0-9]/g, '');
    const mappedPrimary = SYMBOL_ALIASES[first] ?? first;
    return Array.from(new Set([base, noSuffix, first, mappedPrimary].filter(Boolean)));
  }

  function loadMockScenario(mode: 'swing' | 'fno') {
    const today = new Date();
    const d = (offset: number) => new Date(today.getTime() - offset * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const swing: StockTransaction[] = [
      { id: `m1_${Date.now()}`, date: d(70), scriptName: 'RELIANCE', exchange: 'NSE', quantity: 10, price: 2745, type: 'buy' },
      { id: `m2_${Date.now()}`, date: d(55), scriptName: 'TCS', exchange: 'NSE', quantity: 8, price: 3860, type: 'buy' },
      { id: `m3_${Date.now()}`, date: d(44), scriptName: 'INFY', exchange: 'NSE', quantity: 20, price: 1510, type: 'buy' },
      { id: `m4_${Date.now()}`, date: d(18), scriptName: 'RELIANCE', exchange: 'NSE', quantity: 2, price: 2835, type: 'sell' },
    ];
    const fno: StockTransaction[] = [
      { id: `m5_${Date.now()}`, date: d(60), scriptName: 'HDFCBANK', exchange: 'NSE', quantity: 25, price: 1580, type: 'buy' },
      { id: `m6_${Date.now()}`, date: d(50), scriptName: 'ICICIBANK', exchange: 'NSE', quantity: 20, price: 1225, type: 'buy' },
      { id: `m7_${Date.now()}`, date: d(35), scriptName: 'SBIN', exchange: 'NSE', quantity: 40, price: 720, type: 'buy' },
      { id: `m8_${Date.now()}`, date: d(12), scriptName: 'SBIN', exchange: 'NSE', quantity: 10, price: 780, type: 'sell' },
    ];
    updateTx(mode === 'swing' ? swing : fno);
    setLiveStatus(`Prototype loaded: ${mode === 'swing' ? 'Swing basket' : 'Banking/F&O basket'}`);
  }

  function clearPortfolio() {
    updateTx([]);
    setLivePrices({});
    setLiveQuoteMeta({});
    setOptionsRows([]);
    setOptionsMeta({});
    setOptionsSource('mock');
    setOptimizerLive(null);
    setEquityDataLive([]);
    setLiveStatus('Portfolio cleared');
  }

  function resetAppState() {
    clearPortfolio();
    setLiveMode(false);
    setSearch('');
    setPeRange({ min: 0, max: 100 });
    setRsiRange({ min: 0, max: 100 });
    setMinVolume(0);
    setRange({ start: '2024-01-01', end: new Date().toISOString().slice(0, 10) });
    setActiveTab('Prototype');
    setLiveStatus('App reset complete');
  }

  function startEditHolding(h: { symbol: string; quantity: number; avgCost: number; exchange: 'NSE' | 'BSE' }) {
    setEditingSymbol(h.symbol);
    setEditHoldingForm({
      quantity: String(h.quantity),
      avgCost: String(h.avgCost),
      exchange: h.exchange,
    });
  }

  function cancelEditHolding() {
    setEditingSymbol(null);
    setEditHoldingForm({ quantity: '', avgCost: '', exchange: 'NSE' });
  }

  function deleteHolding(symbol: string) {
    const next = transactions.filter((tx) => normalizeInputSymbol(tx.scriptName) !== symbol);
    updateTx(next);
    setLivePrices((prev) => {
      const copy = { ...prev };
      delete copy[symbol];
      return copy;
    });
    setLiveQuoteMeta((prev) => {
      const copy = { ...prev };
      delete copy[symbol];
      return copy;
    });
    if (editingSymbol === symbol) cancelEditHolding();
    setLiveStatus(`Holding deleted: ${symbol}`);
  }

  function saveEditHolding() {
    if (!editingSymbol) return;
    const quantity = Number(editHoldingForm.quantity);
    const avgCost = Number(editHoldingForm.avgCost);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(avgCost) || avgCost <= 0) return;

    const remaining = transactions.filter((tx) => normalizeInputSymbol(tx.scriptName) !== editingSymbol);
    const editedTx: StockTransaction = {
      id: `edit_${Date.now()}_${editingSymbol}`,
      date: new Date().toISOString().slice(0, 10),
      scriptName: editingSymbol,
      exchange: editHoldingForm.exchange,
      quantity,
      price: avgCost,
      type: 'buy',
    };
    updateTx([editedTx, ...remaining]);
    setLivePrices((prev) => {
      const copy = { ...prev };
      delete copy[editingSymbol];
      return copy;
    });
    setLiveQuoteMeta((prev) => {
      const copy = { ...prev };
      delete copy[editingSymbol];
      return copy;
    });
    cancelEditHolding();
    setLiveStatus(`Holding updated: ${editingSymbol}`);
  }

  function addTransaction(e: React.FormEvent) {
    e.preventDefault();
    const quantity = Number(form.quantity);
    const price = Number(form.price);
    if (!form.scriptName || !Number.isFinite(quantity) || !Number.isFinite(price) || quantity <= 0 || price <= 0) return;

    const tx: StockTransaction = {
      id: `${Date.now()}_${normalizeInputSymbol(form.scriptName)}`,
      date: form.date || new Date().toISOString().slice(0, 10),
      scriptName: normalizeInputSymbol(form.scriptName),
      exchange: form.exchange as 'NSE' | 'BSE',
      quantity,
      price,
      type: form.type as 'buy' | 'sell',
    };

    updateTx([tx, ...transactions]);
    setForm({ date: '', scriptName: '', exchange: 'NSE', quantity: '', price: '', type: 'buy' });
    setScriptSuggestOpen(false);
    setScriptSuggestIndex(-1);
  }

  function selectScriptSuggestion(symbol: string, exchange: 'NSE' | 'BSE') {
    setForm((prev) => ({ ...prev, scriptName: symbol, exchange }));
    setScriptSuggestOpen(false);
    setScriptSuggestIndex(-1);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const parsed = await parseUpload(file);
    updateTx([...parsed, ...transactions]);
    e.target.value = '';
  }

  async function refreshLivePrices() {
    if (!liveMode) return;
    setLiveStatus('Refreshing live quotes...');
    const next: Record<string, number> = { ...livePrices };
    const nextMeta: Record<string, { source: string; asOf: string; prevClose?: number; changePct?: number }> = { ...liveQuoteMeta };
    let ok = 0;
    let failed = 0;
    const failedSymbols: string[] = [];
    const failReasons: Record<string, string> = {};

    const trackedSymbols = Array.from(
      new Set([
        ...holdingsBase.map((h) => normalizeInputSymbol(h.symbol)),
        ...decisions.filter((d) => d.status === 'active').map((d) => normalizeInputSymbol(d.symbol)),
      ]),
    );

    for (const symbol of trackedSymbols) {
      const holding = holdingsBase.find((h) => normalizeInputSymbol(h.symbol) === symbol);
      const exchange = holding?.exchange ?? 'NSE';
      let found = false;
      let lastErr = '';
      for (const candidate of symbolCandidates(symbol)) {
        try {
          const q = await fetchQuote(candidate, exchange);
          if (typeof q.price === 'number' && Number.isFinite(q.price) && q.price > 0) {
            next[symbol] = q.price;
            nextMeta[symbol] = {
              source: q.source ?? 'unknown',
              asOf: q.as_of ?? '',
              prevClose: q.prev_close,
              changePct: q.change_pct,
            };
            found = true;
            ok += 1;
            break;
          }
        } catch (err) {
          // try next candidate
          lastErr = String(err);
        }
      }
      if (!found) {
        failed += 1;
        failedSymbols.push(symbol);
        failReasons[symbol] = lastErr || 'no_valid_price';
      }
    }

    setLivePrices(next);
    setLiveQuoteMeta(nextMeta);
    if (failedSymbols.length > 0) {
      const reasonPreview = failedSymbols
        .slice(0, 3)
        .map((s) => `${s}:${(failReasons[s] || '').slice(0, 80)}`)
        .join(' | ');
      setLiveStatus(`Live prices refreshed: ${ok} success, ${failed} failed (${failedSymbols.join(', ')}) ${reasonPreview ? `- ${reasonPreview}` : ''}`);
    } else {
      setLiveStatus(`Live prices refreshed: ${ok} success, ${failed} failed`);
    }
  }

  async function refreshTransactionsFromServer(userId: string) {
    const fresh = await fetchTransactions(userId);
    setTransactions(fresh);
    saveTransactions(fresh, userId);
  }

  async function syncBrokerNow() {
    if (!user?.uid) {
      setLiveStatus('Login first to run broker sync.');
      return;
    }
    try {
      setIntegrationBusy(true);
      if (brokerChoice !== 'demo' && !brokerConnected) {
        setLiveStatus(`Connect ${brokerChoice} with OAuth before syncing.`);
        return;
      }
      setLiveStatus(`Syncing broker (${brokerChoice})...`);
      const res = await syncBrokerPortfolio(user.uid, brokerChoice);
      setBrokerImportedCount(res.imported_count);
      await refreshTransactionsFromServer(user.uid);
      setLiveStatus(`Broker sync complete: ${res.imported_count} positions imported [${res.source}]`);
    } catch (err) {
      setLiveStatus(`Broker sync failed: ${String(err).slice(0, 120)}`);
    } finally {
      setIntegrationBusy(false);
    }
  }

  async function connectBrokerNow() {
    if (!user?.uid) {
      setLiveStatus('Login first to connect broker.');
      return;
    }
    if (brokerChoice === 'demo') {
      setLiveStatus('Demo broker does not require OAuth.');
      return;
    }
    try {
      setIntegrationBusy(true);
      const res = await startBrokerOAuth(user.uid, brokerChoice as 'zerodha' | 'upstox' | 'angelone' | 'icici');
      if (!res.configured) {
        const r = await fetch(res.auth_url);
        if (!r.ok) throw new Error(await r.text());
        const status = await fetchBrokerOAuthStatus(user.uid, brokerChoice as 'zerodha' | 'upstox' | 'angelone' | 'icici');
        setBrokerConnected(status.connected);
        const expires = status.expires_at ? new Date(status.expires_at).toLocaleString('en-IN') : 'N/A';
        setBrokerStatusLabel(status.connected ? `Connected (${status.token_source || 'token'}) exp: ${expires}` : 'Not connected');
        setLiveStatus(`OAuth connected for ${brokerChoice} in ${res.mode} mode.`);
        return;
      }
      if (typeof window !== 'undefined') {
        const popup = window.open(res.auth_url, '_blank', 'noopener,noreferrer');
        if (!popup) {
          window.location.href = res.auth_url;
        }
      }
      setLiveStatus(`OAuth started for ${brokerChoice}. Complete login in opened tab, then run Sync Broker.`);
    } catch (err) {
      setLiveStatus(`Broker connect failed: ${String(err).slice(0, 140)}`);
    } finally {
      setIntegrationBusy(false);
    }
  }

  async function disconnectBrokerNow() {
    if (!user?.uid || brokerChoice === 'demo') return;
    try {
      setIntegrationBusy(true);
      await disconnectBrokerOAuth(user.uid, brokerChoice as 'zerodha' | 'upstox' | 'angelone' | 'icici');
      setBrokerConnected(false);
      setBrokerStatusLabel('Disconnected');
      setLiveStatus(`Broker ${brokerChoice} disconnected.`);
    } catch (err) {
      setLiveStatus(`Broker disconnect failed: ${String(err).slice(0, 140)}`);
    } finally {
      setIntegrationBusy(false);
    }
  }

  async function loginWithGoogleNow() {
    try {
      setLiveStatus('Opening Google login popup...');
      await loginWithGoogle();
      setLiveStatus('Google login successful.');
    } catch (err) {
      const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code || '') : '';
      const message = typeof err === 'object' && err && 'message' in err ? String((err as { message?: unknown }).message || '') : String(err);

      if (code === 'auth/unauthorized-domain') {
        setLiveStatus('Google login failed: unauthorized domain. Add this domain in Firebase Auth > Settings > Authorized domains.');
        return;
      }
      if (code === 'auth/popup-blocked') {
        setLiveStatus('Google login failed: popup blocked by browser. Allow popups and try again.');
        return;
      }
      if (code === 'auth/popup-closed-by-user') {
        setLiveStatus('Google login cancelled: popup was closed before completion.');
        return;
      }
      if (code === 'auth/operation-not-allowed') {
        setLiveStatus('Google login failed: Google provider is disabled in Firebase Authentication.');
        return;
      }
      setLiveStatus(`Google login failed${code ? ` (${code})` : ''}: ${message.slice(0, 140)}`);
    }
  }

  useEffect(() => {
    const activeDecisionCount = decisions.filter((d) => d.status === 'active').length;
    if (!liveMode || (holdingsBase.length === 0 && activeDecisionCount === 0)) return;
    void refreshLivePrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, holdingsBase, decisions]);

  useEffect(() => {
    if (!liveMode) return;
    if (Object.keys(livePrices).length === 0) return;
    const active = decisions.filter((d) => d.status === 'active');
    if (active.length === 0) return;

    const nextAlerts: Array<{ id: string; symbol: string; kind: 'target' | 'stop'; message: string; at: string }> = [];
    const nextLastFired = { ...alertLastFired };
    const nextDecisions = [...decisions];
    const nowMs = Date.now();
    const cooldownMs = Math.max(1, alertCooldownMins) * 60 * 1000;

    for (const d of active) {
      const symbol = normalizeInputSymbol(d.symbol);
      const px = livePrices[symbol];
      if (!px || !Number.isFinite(px)) continue;

      const targetKey = `${d.id}:target`;
      const stopKey = `${d.id}:stop`;
      const targetLast = nextLastFired[targetKey] ? new Date(nextLastFired[targetKey]).getTime() : 0;
      const stopLast = nextLastFired[stopKey] ? new Date(nextLastFired[stopKey]).getTime() : 0;

      if (px >= d.targetPrice && nowMs - targetLast >= cooldownMs) {
        nextLastFired[targetKey] = new Date(nowMs).toISOString();
        nextAlerts.push({
          id: targetKey,
          symbol,
          kind: 'target',
          message: `${symbol} hit target (${px.toFixed(2)} >= ${d.targetPrice.toFixed(2)})`,
          at: new Date().toISOString(),
        });
        if (autoCloseOnAlert) {
          const idx = nextDecisions.findIndex((x) => x.id === d.id);
          if (idx >= 0) {
            nextDecisions[idx] = {
              ...nextDecisions[idx],
              status: 'hit_target',
              closedPrice: px,
              closedAt: new Date().toISOString(),
              reviewScore: computeDecisionReviewScore(nextDecisions[idx], 'hit_target', px),
              updatedAt: new Date().toISOString(),
            };
          }
        }
      }
      if (px <= d.stopLoss && nowMs - stopLast >= cooldownMs) {
        nextLastFired[stopKey] = new Date(nowMs).toISOString();
        nextAlerts.push({
          id: stopKey,
          symbol,
          kind: 'stop',
          message: `${symbol} hit stop-loss (${px.toFixed(2)} <= ${d.stopLoss.toFixed(2)})`,
          at: new Date().toISOString(),
        });
        if (autoCloseOnAlert) {
          const idx = nextDecisions.findIndex((x) => x.id === d.id);
          if (idx >= 0) {
            nextDecisions[idx] = {
              ...nextDecisions[idx],
              status: 'stopped',
              closedPrice: px,
              closedAt: new Date().toISOString(),
              reviewScore: computeDecisionReviewScore(nextDecisions[idx], 'stopped', px),
              updatedAt: new Date().toISOString(),
            };
          }
        }
      }
    }

    if (nextAlerts.length > 0) {
      setAlerts((prev) => [...nextAlerts, ...prev].slice(0, 80));
      setAlertLastFired(nextLastFired);
      if (autoCloseOnAlert) updateDecisions(nextDecisions);
      if (browserNotify && typeof Notification !== 'undefined') {
        if (Notification.permission === 'granted') {
          // fire only the latest alert notification to keep it lightweight
          const latest = nextAlerts[0];
          new Notification(`Stock Alert: ${latest.symbol}`, { body: latest.message });
        } else if (Notification.permission === 'default') {
          void Notification.requestPermission();
        }
      }
      if (soundNotify && typeof window !== 'undefined') {
        try {
          const AudioCtor =
            (window as Window & { AudioContext?: typeof AudioContext }).AudioContext
            || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioCtor) throw new Error('No AudioContext available');
          const ctx = new AudioCtor();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = 880;
          gain.gain.value = 0.04;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.15);
        } catch {
          // no-op
        }
      }
      setLiveStatus(`Alert: ${nextAlerts[0].message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, livePrices, decisions, alertLastFired, alertCooldownMins, autoCloseOnAlert, browserNotify, soundNotify]);

  useEffect(() => {
    if (Object.keys(livePrices).length === 0) return;
    const normalizedMap: Record<string, number> = {};
    for (const [k, v] of Object.entries(livePrices)) {
      normalizedMap[normalizeDisplaySymbol(k)] = v;
      normalizedMap[k] = v;
    }
    if (JSON.stringify(normalizedMap) !== JSON.stringify(livePrices)) {
      setLivePrices(normalizedMap);
    }
  }, [livePrices]);

  useEffect(() => {
    if (Object.keys(liveQuoteMeta).length === 0) return;
    const normalizedMeta: Record<string, { source: string; asOf: string; prevClose?: number; changePct?: number }> = {};
    for (const [k, v] of Object.entries(liveQuoteMeta)) {
      normalizedMeta[normalizeDisplaySymbol(k)] = v;
      normalizedMeta[k] = v;
    }
    if (JSON.stringify(normalizedMeta) !== JSON.stringify(liveQuoteMeta)) {
      setLiveQuoteMeta(normalizedMeta);
    }
  }, [liveQuoteMeta]);

  async function loadOptions() {
    const symbol = holdings[0]?.symbol || 'RELIANCE';
    try {
      setLiveStatus(`Loading options for ${symbol}...`);
      const chain = await fetchOptions(symbol);
      const rows = chain.rows.slice(0, 20).map((r) => ({
        strike: r.strike,
        callLtp: Number(r.call?.ltp ?? 0),
        putLtp: Number(r.put?.ltp ?? 0),
        iv: Number(r.call?.iv ?? r.put?.iv ?? 0),
        oi: Number(r.call?.oi ?? 0) + Number(r.put?.oi ?? 0),
      }));
      setOptionsRows(rows);
      setOptionsMeta({ spot: chain.spot, expiry: chain.expiry });
      setOptionsSource(chain.source === 'nse_live' ? 'live_nse' : chain.source === 'fallback' ? 'fallback' : 'mock');
      setLiveStatus('Options loaded');
    } catch (err) {
      setOptionsSource('mock');
      setLiveStatus(`Options load failed: ${String(err)}`);
    }
  }

  async function runLiveOptimizer() {
    const symbols = holdings.map((h) => h.symbol).slice(0, 12);
    const targetSymbols = symbols.length >= 2 ? symbols : ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK'];
    try {
      setLiveStatus('Running live optimizer...');
      const result = await optimizePortfolioLive(targetSymbols, 'NSE');
      setOptimizerLive(result);
      setLiveStatus('Optimizer complete');
    } catch (err) {
      setLiveStatus(`Optimizer failed: ${String(err)}`);
    }
  }

  async function runLiveBacktest() {
    const symbols = holdings.map((h) => h.symbol).slice(0, 8);
    const targetSymbols = symbols.length > 0 ? symbols : ['RELIANCE', 'TCS', 'INFY'];
    try {
      setLiveStatus('Running live backtest...');
      const points = await backtestLive(targetSymbols, range.start, range.end, 'NSE');
      setEquityDataLive(points);
      setLiveStatus('Backtest complete');
    } catch (err) {
      setLiveStatus(`Backtest failed: ${String(err)}`);
    }
  }

  const optimization = optimizerLive ?? optimizationLocal;
  const equityData = equityDataLive.length > 0 ? equityDataLive : equityDataLocal;
  const screenerSource = liveMode && liveUniverse.length > 0 ? 'Live NSE' : 'Mock';
  const holdingsSource = liveMode && Object.keys(livePrices).length > 0 ? 'Live NSE' : 'Mock';
  const backtestSource = equityDataLive.length > 0 ? 'Live NSE' : 'Mock';
  const optimizerSource = optimizerLive ? 'Live NSE' : 'Mock';
  const optionsSourceLabel = optionsSource === 'live_nse' ? 'Live NSE' : optionsSource === 'fallback' ? 'Fallback' : 'Mock';
  const activeDecisions = decisions.filter((d) => d.status === 'active');
  const closedDecisions = decisions.filter((d) => d.status !== 'active');
  const avgReviewScore = closedDecisions.length > 0
    ? closedDecisions.reduce((s, d) => s + (d.reviewScore ?? 0), 0) / closedDecisions.length
    : 0;

  const symbolToSector = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of universe) m[normalizeInputSymbol(u.symbol)] = u.sector || 'Other';
    return m;
  }, [universe]);

  const positionRiskWarnings = useMemo(() => {
    if (summary.total <= 0) return [] as string[];
    return holdingsWithMetrics
      .map((h) => ({ symbol: h.symbol, pct: (h.value / summary.total) * 100 }))
      .filter((x) => x.pct > riskLimits.maxPositionPct)
      .map((x) => `${x.symbol} position ${x.pct.toFixed(1)}% > ${riskLimits.maxPositionPct}%`);
  }, [holdingsWithMetrics, riskLimits.maxPositionPct, summary.total]);

  const sectorRiskWarnings = useMemo(() => {
    if (summary.total <= 0) return [] as string[];
    const sectorTotals: Record<string, number> = {};
    for (const h of holdingsWithMetrics) {
      const sector = symbolToSector[normalizeInputSymbol(h.symbol)] || 'Other';
      sectorTotals[sector] = (sectorTotals[sector] || 0) + h.value;
    }
    return Object.entries(sectorTotals)
      .map(([sector, value]) => ({ sector, pct: (value / summary.total) * 100 }))
      .filter((x) => x.pct > riskLimits.maxSectorPct)
      .map((x) => `${x.sector} exposure ${x.pct.toFixed(1)}% > ${riskLimits.maxSectorPct}%`);
  }, [holdingsWithMetrics, riskLimits.maxSectorPct, summary.total, symbolToSector]);

  const dailyLossWarning = overallDayPnl <= -Math.abs(riskLimits.maxDailyLoss)
    ? `Daily loss ${overallDayPnl.toFixed(2)} breached -${Math.abs(riskLimits.maxDailyLoss).toFixed(2)}`
    : '';

  const riskGuardBreachCount = (dailyLossWarning ? 1 : 0) + positionRiskWarnings.length + sectorRiskWarnings.length;
  const riskGuardState: 'green' | 'yellow' | 'red' = dailyLossWarning || riskGuardBreachCount >= 3
    ? 'red'
    : riskGuardBreachCount > 0
      ? 'yellow'
      : 'green';
  const riskGuardStyle = riskGuardState === 'red'
    ? { background: '#7f1d1d', color: '#fecaca' }
    : riskGuardState === 'yellow'
      ? { background: '#78350f', color: '#fde68a' }
      : { background: '#14532d', color: '#bbf7d0' };
  const riskGuardLabel = riskGuardState === 'red'
    ? `Risk Guard: High (${riskGuardBreachCount})`
    : riskGuardState === 'yellow'
      ? `Risk Guard: Medium (${riskGuardBreachCount})`
      : 'Risk Guard: Safe';

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Stock Analyzer Pro</h1>
          <p>Step 3 UI-first prototype + live data bridge</p>
        </div>
        <div className="authBox">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={liveMode} onChange={(e) => setLiveMode(e.target.checked)} />
            Live Mode
          </label>
          {user ? (
            <>
              <span>{user.displayName}</span>
              <button onClick={logout}>Logout</button>
            </>
          ) : (
            <button onClick={() => { void loginWithGoogleNow(); }}>Google Login</button>
          )}
          {liveMode && <button onClick={refreshLivePrices}>Refresh Quotes</button>}
        </div>
      </header>
      {liveStatus && <p className="muted">{liveStatus}</p>}
      {!liveMode && holdingsBase.length > 0 && <p className="muted">Live Mode is OFF: Market uses avg-cost baseline (not live exchange price).</p>}
      {alerts.length > 0 && (
        <section className="card" style={{ marginBottom: 12 }}>
          <div className="widgetHead"><h3>Alerts</h3><span className="sourceBadge">{alerts.length}</span></div>
          <div className="actionRow" style={{ marginBottom: 8 }}>
            <button onClick={() => setAlerts([])}>Clear Alerts</button>
          </div>
          <div className="txList">
            {alerts.slice(0, 12).map((a) => (
              <div key={a.id} className="txItem">
                <strong>{a.symbol}</strong>
                <span className={a.kind === 'target' ? 'profit' : 'loss'}>{a.kind.toUpperCase()}</span>
                <span>{a.message}</span>
                <span>{new Date(a.at).toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="card" style={{ marginBottom: 12 }}>
        <div className="widgetHead"><h3>Alert & Risk Guard</h3><span className="sourceBadge">Local Rules</span></div>
        <div className="filters">
          <label>
            <input type="checkbox" checked={autoCloseOnAlert} onChange={(e) => setAutoCloseOnAlert(e.target.checked)} />
            Auto-close decision on alert
          </label>
          <label>
            <input type="checkbox" checked={browserNotify} onChange={(e) => setBrowserNotify(e.target.checked)} />
            Browser notify
          </label>
          <label>
            <input type="checkbox" checked={soundNotify} onChange={(e) => setSoundNotify(e.target.checked)} />
            Sound notify
          </label>
          <label>Cooldown (mins)
            <input type="number" min={1} max={240} value={alertCooldownMins} onChange={(e) => setAlertCooldownMins(Number(e.target.value) || 15)} />
          </label>
          <label>Max Position %
            <input type="number" min={1} max={100} value={riskLimits.maxPositionPct} onChange={(e) => setRiskLimits({ ...riskLimits, maxPositionPct: Number(e.target.value) || 25 })} />
          </label>
          <label>Max Sector %
            <input type="number" min={1} max={100} value={riskLimits.maxSectorPct} onChange={(e) => setRiskLimits({ ...riskLimits, maxSectorPct: Number(e.target.value) || 45 })} />
          </label>
          <label>Max Daily Loss (INR)
            <input type="number" min={1} value={riskLimits.maxDailyLoss} onChange={(e) => setRiskLimits({ ...riskLimits, maxDailyLoss: Number(e.target.value) || 5000 })} />
          </label>
        </div>
        <div className="txList">
          {dailyLossWarning && <div className="txItem"><strong className="loss">Daily Loss Warning</strong><span>{dailyLossWarning}</span></div>}
          {positionRiskWarnings.slice(0, 4).map((w) => <div key={w} className="txItem"><strong className="loss">Position Risk</strong><span>{w}</span></div>)}
          {sectorRiskWarnings.slice(0, 4).map((w) => <div key={w} className="txItem"><strong className="loss">Sector Risk</strong><span>{w}</span></div>)}
          {!dailyLossWarning && positionRiskWarnings.length === 0 && sectorRiskWarnings.length === 0 && (
            <div className="txItem"><span className="profit">No Risk Guard breaches.</span></div>
          )}
        </div>
      </section>

      <nav className="tabs">
        {tabs.map((tab) => (
          <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === 'Prototype' && (
        <section className="grid two">
          <article className="card">
            <div className="widgetHead"><h3>UI-First Prototype Flow</h3><span className="sourceBadge">Mock</span></div>
            <div className="protoGrid">
              <div className="protoItem"><strong>1. Portfolio Setup</strong><span>Add trades manually or use Excel/CSV upload</span></div>
              <div className="protoItem"><strong>2. Screener</strong><span>Filter by PE, RSI, and volume to shortlist symbols</span></div>
              <div className="protoItem"><strong>3. Options Desk</strong><span>Inspect options chain, IV, OI, and Greeks</span></div>
              <div className="protoItem"><strong>4. Backtesting</strong><span>Run historical curve for selected basket and date range</span></div>
              <div className="protoItem"><strong>5. Optimizer</strong><span>Compute max-Sharpe mean-variance weights</span></div>
              <div className="protoItem"><strong>6. Switch to Live</strong><span>Enable Live Mode to call backend APIs</span></div>
            </div>
          </article>

          <article className="card">
            <div className="widgetHead"><h3>Quick Start Actions</h3><span className="sourceBadge">{liveMode ? 'Live NSE' : 'Mock'}</span></div>
            <div className="actionRow">
              <button onClick={() => loadMockScenario('swing')}>Load Mock Swing Portfolio</button>
              <button onClick={() => loadMockScenario('fno')}>Load Mock Banking Portfolio</button>
            </div>
            <div className="actionRow">
              <button onClick={() => setActiveTab('Portfolio')}>Go to Portfolio</button>
              <button onClick={() => setActiveTab('Screener')}>Go to Screener</button>
              <button onClick={() => setActiveTab('Options')}>Go to Options</button>
            </div>
            <div className="actionRow">
              <button onClick={clearPortfolio}>Clear Portfolio</button>
              <button onClick={resetAppState}>Reset App</button>
            </div>
            <p className="muted">
              Data Source: <strong>{liveMode ? 'Live Backend APIs' : 'Prototype Mock + Local Models'}</strong>
            </p>
          </article>
        </section>
      )}

      {activeTab === 'Dashboard' && (
        <section className="grid two">
          <article className="card summary">
            <div className="widgetHead">
              <h3>Portfolio Snapshot</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="sourceBadge">{holdingsSource}</span>
                <span className="sourceBadge" style={riskGuardStyle}>{riskGuardLabel}</span>
              </div>
            </div>
            <div className="summaryRow"><span>Total Value</span><strong>INR {summary.total.toLocaleString('en-IN')}</strong></div>
            <div className="summaryRow"><span>Invested</span><strong>INR {summary.invested.toLocaleString('en-IN')}</strong></div>
            <div className="summaryRow"><span>PnL</span><strong className={summary.pnl >= 0 ? 'profit' : 'loss'}>{summary.pnl >= 0 ? '+' : ''}INR {summary.pnl.toLocaleString('en-IN')} ({summary.pnlPct.toFixed(2)}%)</strong></div>
            <div className="summaryRow"><span>Day PnL</span><strong className={overallDayPnl >= 0 ? 'profit' : 'loss'}>{overallDayPnl >= 0 ? '+' : ''}INR {overallDayPnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong></div>
            <div className="summaryRow"><span>Highest Profit</span><strong className="profit">{highestProfit ? `${highestProfit.symbol} (INR ${highestProfit.pnl.toFixed(2)})` : '-'}</strong></div>
            <div className="summaryRow"><span>Highest Loss</span><strong className="loss">{highestLoss ? `${highestLoss.symbol} (INR ${highestLoss.pnl.toFixed(2)})` : '-'}</strong></div>
            <div className="summaryRow"><span>Active Holdings</span><strong>{holdings.length}</strong></div>
            <div className="summaryRow"><span>NSE Universe Loaded</span><strong>{universe.length}</strong></div>
          </article>

          <article className="card">
            <div className="widgetHead">
              <h3>Allocation</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="sourceBadge">{holdingsSource}</span>
                <span className="sourceBadge" style={riskGuardStyle}>{riskGuardLabel}</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={allocationData} dataKey="value" nameKey="name" outerRadius={95} fill="#0ea5e9" />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </article>

          <article className="card">
            <div className="widgetHead">
              <h3>PnL by Holding</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="sourceBadge">{holdingsSource}</span>
                <span className="sourceBadge" style={riskGuardStyle}>{riskGuardLabel}</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={pnlData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="symbol" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="pnl" fill="#16a34a" />
              </BarChart>
            </ResponsiveContainer>
          </article>

          <article className="card">
            <div className="widgetHead">
              <h3>Backtest Equity Curve</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className="sourceBadge">{backtestSource}</span>
                <span className="sourceBadge" style={riskGuardStyle}>{riskGuardLabel}</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={equityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Area dataKey="equity" stroke="#6366f1" fill="#6366f155" />
              </AreaChart>
            </ResponsiveContainer>
          </article>
        </section>
      )}

      {activeTab === 'Portfolio' && (
        <section className="grid two">
          <article className="card">
            <div className="widgetHead"><h3>Add Transaction</h3><span className="sourceBadge">Mock</span></div>
            <form className="form" onSubmit={addTransaction}>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              <div className="suggestWrap">
                <input
                  placeholder="Script name (e.g. RELIANCE)"
                  value={form.scriptName}
                  onFocus={() => {
                    setScriptSuggestOpen(true);
                    setScriptSuggestIndex(-1);
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      setScriptSuggestOpen(false);
                      setScriptSuggestIndex(-1);
                    }, 120);
                  }}
                  onChange={(e) => {
                    setForm({ ...form, scriptName: e.target.value });
                    setScriptSuggestOpen(true);
                    setScriptSuggestIndex(-1);
                  }}
                  onKeyDown={(e) => {
                    if (!scriptSuggestOpen || manualScriptSuggestions.length === 0) return;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setScriptSuggestIndex((prev) => Math.min(prev + 1, manualScriptSuggestions.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setScriptSuggestIndex((prev) => Math.max(prev - 1, 0));
                    } else if (e.key === 'Enter') {
                      if (scriptSuggestIndex >= 0 && scriptSuggestIndex < manualScriptSuggestions.length) {
                        e.preventDefault();
                        const item = manualScriptSuggestions[scriptSuggestIndex];
                        selectScriptSuggestion(item.symbol, item.exchange);
                      }
                    } else if (e.key === 'Escape') {
                      setScriptSuggestOpen(false);
                      setScriptSuggestIndex(-1);
                    }
                  }}
                />
                {scriptSuggestOpen && manualScriptSuggestions.length > 0 && (
                  <div className="suggestList">
                    {manualScriptSuggestions.map((s, idx) => (
                      <button
                        key={s.symbol}
                        type="button"
                        className={`suggestItem${idx === scriptSuggestIndex ? ' active' : ''}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectScriptSuggestion(s.symbol, s.exchange);
                        }}
                      >
                        <strong>{s.symbol} ({s.exchange})</strong>
                        <span>{s.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <select value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value })}>
                <option value="NSE">NSE</option>
                <option value="BSE">BSE</option>
              </select>
              <input type="number" placeholder="Quantity" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              <input type="number" placeholder="Price" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="buy">Buy (+)</option>
                <option value="sell">Sell (-)</option>
              </select>
              <button type="submit">Add</button>
            </form>

            <div className="uploadBox">
              <label>Upload CSV/XLSX (Date, Script name, Exchange, Quantity, Price, type(+buy/-sell))</label>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={onUpload} />
            </div>
            <div className="uploadBox" style={{ marginTop: 10 }}>
              <label>Broker Synchronisation</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select value={brokerChoice} onChange={(e) => setBrokerChoice(e.target.value as 'demo' | 'zerodha' | 'upstox' | 'angelone' | 'icici')}>
                  <option value="demo">Demo Broker</option>
                  <option value="zerodha">Zerodha</option>
                  <option value="upstox">Upstox</option>
                  <option value="angelone">Angel One</option>
                  <option value="icici">ICICI Direct</option>
                </select>
                {brokerChoice !== 'demo' && (
                  <button onClick={connectBrokerNow} disabled={integrationBusy}>
                    {integrationBusy ? 'Connecting...' : 'Connect OAuth'}
                  </button>
                )}
                {brokerChoice !== 'demo' && brokerConnected && (
                  <button onClick={disconnectBrokerNow} disabled={integrationBusy}>Disconnect</button>
                )}
                <button onClick={syncBrokerNow} disabled={integrationBusy}>{integrationBusy ? 'Syncing...' : 'Sync Broker'}</button>
                <span className="muted">Imported: {brokerImportedCount}</span>
                <span className="muted">Mode: {integrationMode}</span>
                <span className="muted">{brokerStatusLabel}</span>
              </div>
            </div>
            <div className="actionRow">
              <button onClick={clearPortfolio}>Clear Portfolio</button>
              <button onClick={resetAppState}>Reset App</button>
            </div>
          </article>

          <article className="card">
            <div className="widgetHead"><h3>Holdings</h3><span className="sourceBadge">{holdingsSource}</span></div>
            <div className="summaryRow"><span>Overall PnL</span><strong className={summary.pnl >= 0 ? 'profit' : 'loss'}>{summary.pnl >= 0 ? '+' : ''}INR {summary.pnl.toFixed(2)}</strong></div>
            <div className="summaryRow"><span>Day PnL</span><strong className={overallDayPnl >= 0 ? 'profit' : 'loss'}>{overallDayPnl >= 0 ? '+' : ''}INR {overallDayPnl.toFixed(2)}</strong></div>
            <div className="summaryRow"><span>Highest Profit</span><strong className="profit">{highestProfit ? `${highestProfit.symbol} (${highestProfit.pnl.toFixed(2)})` : '-'}</strong></div>
            <div className="summaryRow"><span>Highest Loss</span><strong className="loss">{highestLoss ? `${highestLoss.symbol} (${highestLoss.pnl.toFixed(2)})` : '-'}</strong></div>
            <div className="actionRow" style={{ marginTop: 10, marginBottom: 8 }}>
              <button onClick={() => setHoldingsSort('profit_desc')}>Sort: Highest Profit</button>
              <button onClick={() => setHoldingsSort('profit_asc')}>Sort: Highest Loss</button>
              <button onClick={() => setHoldingsSort('day_desc')}>Sort: Day Profit</button>
              <button onClick={() => setHoldingsSort('day_asc')}>Sort: Day Loss</button>
            </div>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th><th>Qty</th><th>Avg Cost</th><th>Market</th><th>Value</th><th>Day PnL</th><th>Total PnL</th><th>PnL%</th><th>Source</th><th>As Of</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {holdingsSorted.map((h) => (
                    <tr key={h.symbol}>
                      <td>{h.symbol}</td>
                      <td>{h.quantity}</td>
                      <td>{h.avgCost.toFixed(2)}</td>
                      <td>{h.marketPrice.toFixed(2)}</td>
                      <td>{h.value.toFixed(2)}</td>
                      <td className={(h.dayPnl ?? 0) >= 0 ? 'profit' : 'loss'}>
                        {h.dayPnl == null ? '-' : `${h.dayPnl >= 0 ? '+' : ''}${h.dayPnl.toFixed(2)}`}
                      </td>
                      <td className={h.pnl >= 0 ? 'profit' : 'loss'}>
                        {h.pnl >= 0 ? '+' : ''}{h.pnl.toFixed(2)}
                      </td>
                      <td className={h.pnlPct >= 0 ? 'profit' : 'loss'}>{h.pnlPct.toFixed(2)}%</td>
                      <td>{liveMode ? (liveQuoteMeta[h.symbol]?.source ?? 'no_live_quote') : 'avg_cost_baseline'}</td>
                      <td>{liveMode ? (liveQuoteMeta[h.symbol]?.asOf ?? '-') : '-'}</td>
                      <td>
                        {editingSymbol === h.symbol ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              type="number"
                              placeholder="Qty"
                              value={editHoldingForm.quantity}
                              onChange={(e) => setEditHoldingForm({ ...editHoldingForm, quantity: e.target.value })}
                              style={{ width: 70 }}
                            />
                            <input
                              type="number"
                              placeholder="Avg Cost"
                              value={editHoldingForm.avgCost}
                              onChange={(e) => setEditHoldingForm({ ...editHoldingForm, avgCost: e.target.value })}
                              style={{ width: 90 }}
                            />
                            <select
                              value={editHoldingForm.exchange}
                              onChange={(e) => setEditHoldingForm({ ...editHoldingForm, exchange: e.target.value as 'NSE' | 'BSE' })}
                            >
                              <option value="NSE">NSE</option>
                              <option value="BSE">BSE</option>
                            </select>
                            <button onClick={saveEditHolding}>Save</button>
                            <button onClick={cancelEditHolding}>Cancel</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => startEditHolding(h)}>Edit</button>
                            <button onClick={() => deleteHolding(h.symbol)}>Delete</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4>Recent Transactions</h4>
            <div className="txList">
              {transactions.slice(0, 12).map((tx) => (
                <div key={tx.id} className="txItem">
                  <span>{tx.date}</span>
                  <strong>{tx.scriptName}</strong>
                  <span>{tx.type.toUpperCase()}</span>
                  <span>{tx.quantity} @ {tx.price}</span>
                  <button onClick={() => updateTx(transactions.filter((x) => x.id !== tx.id))}>Delete</button>
                </div>
              ))}
            </div>
          </article>
        </section>
      )}

      {activeTab === 'Screener' && (
        <section className="card">
          <div className="widgetHead"><h3>Advanced Screener (PE, RSI, Volume)</h3><span className="sourceBadge">{screenerSource}</span></div>
          <div className="filters">
            <input placeholder="Search symbol" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label>PE Min <input type="number" value={peRange.min} onChange={(e) => setPeRange({ ...peRange, min: Number(e.target.value) })} /></label>
            <label>PE Max <input type="number" value={peRange.max} onChange={(e) => setPeRange({ ...peRange, max: Number(e.target.value) })} /></label>
            <label>RSI Min <input type="number" value={rsiRange.min} onChange={(e) => setRsiRange({ ...rsiRange, min: Number(e.target.value) })} /></label>
            <label>RSI Max <input type="number" value={rsiRange.max} onChange={(e) => setRsiRange({ ...rsiRange, max: Number(e.target.value) })} /></label>
            <label>Volume Min <input type="number" value={minVolume} onChange={(e) => setMinVolume(Number(e.target.value))} /></label>
          </div>
          <p className="muted">Showing {screenerRows.length} of {universe.length} NSE stocks</p>
          <div className="tableWrap">
            <table>
              <thead>
                <tr><th>Symbol</th><th>Name</th><th>Sector</th><th>PE</th><th>RSI</th><th>Volume</th><th>Price</th></tr>
              </thead>
              <tbody>
                {screenerRows.map((x) => (
                  <tr key={x.symbol}>
                    <td>{x.symbol}</td>
                    <td>{x.name}</td>
                    <td>{x.sector}</td>
                    <td>{x.pe.toFixed(2)}</td>
                    <td>{x.rsi.toFixed(2)}</td>
                    <td>{x.volume.toLocaleString('en-IN')}</td>
                    <td>{x.price.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'Options' && (
        <section className="card">
          <div className="widgetHead"><h3>Options Chain with Greeks</h3><span className="sourceBadge">{optionsSourceLabel}</span></div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
            <button onClick={loadOptions}>Load Live Options</button>
            <span className="muted">{optionsMeta.expiry ? `Expiry: ${optionsMeta.expiry}` : ''} {optionsMeta.spot ? `| Spot: ${optionsMeta.spot}` : ''}</span>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr><th>Strike</th><th>Call LTP</th><th>Put LTP</th><th>IV%</th><th>Total OI</th></tr>
              </thead>
              <tbody>
                {optionsRows.map((r) => (
                  <tr key={r.strike}>
                    <td>{r.strike}</td>
                    <td>{r.callLtp.toFixed(2)}</td>
                    <td>{r.putLtp.toFixed(2)}</td>
                    <td>{r.iv.toFixed(2)}</td>
                    <td>{r.oi.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'Backtest' && (
        <section className="card">
          <div className="widgetHead"><h3>Backtesting Engine</h3><span className="sourceBadge">{backtestSource}</span></div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
            <input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
            <button onClick={runLiveBacktest}>Run Live Backtest</button>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={equityData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="equity" stroke="#0ea5e9" fill="#0ea5e944" />
            </AreaChart>
          </ResponsiveContainer>
        </section>
      )}

      {activeTab === 'Optimizer' && (
        <section className="card optimizer">
          <div className="widgetHead"><h3>AI Optimizer (Sharpe / Mean-Variance)</h3><span className="sourceBadge">{optimizerSource}</span></div>
          <button onClick={runLiveOptimizer}>Run Live Optimizer</button>
          <div className="summaryRow"><span>Expected Return</span><strong>{optimization.expectedReturn}%</strong></div>
          <div className="summaryRow"><span>Risk (Vol)</span><strong>{optimization.risk}%</strong></div>
          <div className="summaryRow"><span>Sharpe Ratio</span><strong>{optimization.sharpe}</strong></div>
          <h4>Suggested Weights</h4>
          <div className="tableWrap">
            <table>
              <thead><tr><th>Symbol</th><th>Weight %</th></tr></thead>
              <tbody>
                {optimization.weights.map((w) => (
                  <tr key={w.symbol}><td>{w.symbol}</td><td>{w.weight.toFixed(2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === 'Decisions' && (
        <section className="grid two">
          <article className="card">
            <div className="widgetHead"><h3>Decision Tracker</h3><span className="sourceBadge">User Scoped</span></div>
            <form className="form" onSubmit={addDecision}>
              <input
                placeholder="Symbol (e.g. RELIANCE)"
                value={decisionForm.symbol}
                onChange={(e) => setDecisionForm({ ...decisionForm, symbol: e.target.value })}
              />
              <textarea
                placeholder="Thesis (why buy/hold, trigger, invalidation)"
                value={decisionForm.thesis}
                onChange={(e) => setDecisionForm({ ...decisionForm, thesis: e.target.value })}
                rows={4}
              />
              <input
                type="number"
                placeholder="Target Price"
                value={decisionForm.targetPrice}
                onChange={(e) => setDecisionForm({ ...decisionForm, targetPrice: e.target.value })}
              />
              <input
                type="number"
                placeholder="Stop Loss"
                value={decisionForm.stopLoss}
                onChange={(e) => setDecisionForm({ ...decisionForm, stopLoss: e.target.value })}
              />
              <input
                type="number"
                min={0}
                max={100}
                placeholder="Confidence (0-100)"
                value={decisionForm.confidence}
                onChange={(e) => setDecisionForm({ ...decisionForm, confidence: e.target.value })}
              />
              <select
                value={decisionForm.horizon}
                onChange={(e) => setDecisionForm({ ...decisionForm, horizon: e.target.value as 'swing' | 'positional' | 'longterm' })}
              >
                <option value="swing">Swing</option>
                <option value="positional">Positional</option>
                <option value="longterm">Long Term</option>
              </select>
              <button type="submit">Add Decision</button>
            </form>
            {holdings.length > 0 && (
              <div className="actionRow" style={{ marginTop: 8 }}>
                <span className="muted">Quick symbol:</span>
                {holdings.slice(0, 6).map((h) => (
                  <button key={h.symbol} onClick={() => setDecisionForm({ ...decisionForm, symbol: h.symbol })}>{h.symbol}</button>
                ))}
              </div>
            )}
          </article>

          <article className="card">
            <div className="widgetHead"><h3>Open Decisions</h3><span className="sourceBadge">{activeDecisions.length} Active</span></div>
            <div className="summaryRow"><span>Total Decisions</span><strong>{decisions.length}</strong></div>
            <div className="summaryRow"><span>Active</span><strong>{activeDecisions.length}</strong></div>
            <div className="summaryRow"><span>Closed</span><strong>{closedDecisions.length}</strong></div>
            <div className="summaryRow"><span>Avg Review Score</span><strong>{closedDecisions.length > 0 ? avgReviewScore.toFixed(1) : '-'} </strong></div>
            <div className="tableWrap" style={{ marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th><th>Status</th><th>Target</th><th>Stop</th><th>Confidence</th><th>Horizon</th><th>Score</th><th>Thesis</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id}>
                      <td>{d.symbol}</td>
                      <td>{d.status}</td>
                      <td>{d.targetPrice.toFixed(2)}</td>
                      <td>{d.stopLoss.toFixed(2)}</td>
                      <td>{d.confidence}%</td>
                      <td>{d.horizon}</td>
                      <td>{d.reviewScore ?? '-'}</td>
                      <td>{d.thesis}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button onClick={() => setDecisionStatus(d.id, 'active')}>Active</button>
                          <button onClick={() => setDecisionStatus(d.id, 'hit_target', livePrices[normalizeInputSymbol(d.symbol)])}>Hit Target</button>
                          <button onClick={() => setDecisionStatus(d.id, 'stopped', livePrices[normalizeInputSymbol(d.symbol)])}>Stopped</button>
                          <button onClick={() => setDecisionStatus(d.id, 'invalidated', livePrices[normalizeInputSymbol(d.symbol)])}>Invalidated</button>
                          <button onClick={() => deleteDecision(d.id)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {decisions.length === 0 && (
                    <tr>
                      <td colSpan={9} className="muted">No decisions yet. Add your first thesis.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppBody />
    </AuthProvider>
  );
}
