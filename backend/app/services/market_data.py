from __future__ import annotations

from datetime import datetime

import yfinance as yf

from .nse_client import fetch_equity_quote

SYMBOL_ALIASES = {
    'REC': 'RECLTD',
}


def _normalize_symbol(symbol: str) -> str:
    clean = (symbol or '').upper().strip().replace(' ', '')
    clean = clean.replace('.NS', '').replace('.BO', '').replace('-EQ', '')
    clean = ''.join(ch for ch in clean if ch.isalnum())
    return SYMBOL_ALIASES.get(clean, clean)


def _ticker(symbol: str, exchange: str) -> str:
    suffix = '.NS' if exchange.upper() == 'NSE' else '.BO'
    return f'{_normalize_symbol(symbol)}{suffix}'


def _ticker_candidates(symbol: str, exchange: str) -> list[str]:
    primary = '.NS' if exchange.upper() == 'NSE' else '.BO'
    secondary = '.BO' if primary == '.NS' else '.NS'
    base = _normalize_symbol(symbol)
    return [f'{base}{primary}', f'{base}{secondary}']


def _safe_get(mapping_like, *keys):
    for key in keys:
        try:
            val = mapping_like.get(key)
        except Exception:
            val = None
        if val is not None:
            return val
    return None


def _to_float(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip()
    if not s or s in {'-', '--'}:
        return None
    s = s.replace(',', '').replace('%', '')
    try:
        return float(s)
    except Exception:
        return None


def fetch_quote(symbol: str, exchange: str = 'NSE') -> dict:
    normalized_symbol = _normalize_symbol(symbol)
    # Prefer NSE's own quote feed for equity symbols whenever available.
    # This helps when holdings are tagged BSE but symbol trades reliably on NSE.
    if normalized_symbol and not normalized_symbol.isdigit():
        try:
            nse_q = fetch_equity_quote(normalized_symbol)
            nse_price = _to_float(nse_q.get('price')) or 0
            nse_prev = nse_q.get('prev_close')
            nse_prev_f = _to_float(nse_prev)
            nse_change = nse_q.get('change_pct')
            nse_change_f = _to_float(nse_change)
            if nse_price > 0:
                return {
                    'symbol': normalized_symbol,
                    'exchange': 'NSE',
                    'price': nse_price,
                    'prev_close': nse_prev_f,
                    'change_pct': nse_change_f,
                    'source': 'nse_quote_equity',
                    'as_of': str(nse_q.get('as_of') or datetime.utcnow().isoformat()),
                }
        except Exception:
            pass

    last = 0.0
    prev_f = None
    source = 'yfinance_fast_info'
    used_ticker = ''
    for ticker_code in _ticker_candidates(symbol, exchange):
        t = yf.Ticker(ticker_code)
        info = t.fast_info or {}

        candidate_last = _to_float(_safe_get(info, 'lastPrice', 'last_price', 'regularMarketPrice', 'regular_market_price')) or 0
        candidate_prev = _safe_get(info, 'previousClose', 'previous_close')
        candidate_prev_f = _to_float(candidate_prev)
        candidate_source = 'yfinance_fast_info'

        # Fallback 1: regular info payload
        if candidate_last <= 0:
            try:
                full = t.info or {}
                candidate_last = float(
                    full.get('regularMarketPrice')
                    or full.get('currentPrice')
                    or full.get('previousClose')
                    or 0
                )
                candidate_source = 'yfinance_info'
                if candidate_prev_f is None:
                    p = full.get('previousClose')
                    candidate_prev_f = _to_float(p)
            except Exception:
                pass

        # Fallback 2: intraday recent candle (closer to live than 1d close).
        if candidate_last <= 0:
            try:
                hist = t.history(period='1d', interval='1m', auto_adjust=False)
                if not hist.empty:
                    candidate_last = float(hist['Close'].dropna().iloc[-1])
                    candidate_source = 'yfinance_intraday'
                    if candidate_prev_f is None:
                        day_hist = t.history(period='5d', interval='1d', auto_adjust=False)
                        day_close = day_hist['Close'].dropna() if not day_hist.empty else None
                        if day_close is not None and len(day_close) >= 2:
                            candidate_prev_f = float(day_close.iloc[-2])
            except Exception:
                pass

        if candidate_last > 0:
            last = candidate_last
            prev_f = candidate_prev_f
            source = candidate_source
            used_ticker = ticker_code
            break

    change_pct = ((last - prev_f) / prev_f) * 100 if prev_f and prev_f != 0 else None

    return {
        'symbol': normalized_symbol,
        'exchange': exchange.upper(),
        'price': last,
        'prev_close': prev_f,
        'change_pct': change_pct,
        'source': f'{source}:{used_ticker}' if used_ticker else source,
        'as_of': datetime.utcnow().isoformat(),
    }


def fetch_history(symbol: str, exchange: str = 'NSE', period: str = '1y', interval: str = '1d') -> list[dict]:
    t = yf.Ticker(_ticker(symbol, exchange))
    hist = t.history(period=period, interval=interval, auto_adjust=True)
    points = []
    for idx, row in hist.iterrows():
        points.append({'date': idx.strftime('%Y-%m-%d'), 'close': float(row['Close'])})
    return points


def fetch_history_frame(symbols: list[str], exchange: str = 'NSE', lookback_days: int = 252):
    tickers = ' '.join(_ticker(s, exchange) for s in symbols)
    df = yf.download(tickers=tickers, period=f'{lookback_days + 40}d', interval='1d', auto_adjust=True, progress=False)

    if df.empty:
        return df

    if ('Close' in df.columns) and hasattr(df['Close'], 'columns'):
        closes = df['Close'].copy()
        closes.columns = [c.split('.')[0].upper() for c in closes.columns]
        return closes.dropna(how='all')

    # single symbol case
    single = df[['Close']].rename(columns={'Close': symbols[0].upper()})
    return single.dropna(how='all')
