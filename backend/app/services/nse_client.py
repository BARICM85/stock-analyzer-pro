from __future__ import annotations

from datetime import datetime
from io import StringIO

import pandas as pd
import requests

BASE = 'https://www.nseindia.com'
HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'application/json,text/plain,*/*',
    'Referer': 'https://www.nseindia.com/get-quotes/equity',
    'Connection': 'keep-alive',
}


def _to_float(value):
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


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    # warmup for cookies (some responses can still be 403; continue anyway)
    try:
        s.get(BASE, timeout=10)
    except Exception:
        pass
    return s


def fetch_nse_universe_csv() -> list[dict[str, str]]:
    url = 'https://archives.nseindia.com/content/equities/EQUITY_L.csv'
    res = requests.get(url, timeout=20)
    res.raise_for_status()
    df = pd.read_csv(StringIO(res.text))
    df = df.rename(columns=lambda c: c.strip())
    records = []
    for _, r in df.iterrows():
        symbol = str(r.get('SYMBOL', '')).strip().upper()
        name = str(r.get('NAME OF COMPANY', '')).strip()
        if symbol and name:
            records.append({'symbol': symbol, 'name': name, 'exchange': 'NSE'})
    return records


def fetch_option_chain(symbol: str) -> dict:
    s = _session()
    endpoint = f'{BASE}/api/option-chain-equities?symbol={symbol.upper()}'
    res = s.get(endpoint, timeout=15)
    res.raise_for_status()
    data = res.json()

    records = data.get('records', {})
    rows = []
    for item in records.get('data', []):
        strike = item.get('strikePrice')
        if strike is None:
            continue
        ce = item.get('CE')
        pe = item.get('PE')
        rows.append({'strike': strike, 'ce': ce, 'pe': pe})

    return {
        'symbol': symbol.upper(),
        'expiry': records.get('expiryDates', [None])[0] if records.get('expiryDates') else None,
        'spot': records.get('underlyingValue'),
        'rows': rows,
        'timestamp': datetime.utcnow().isoformat(),
    }


def fetch_equity_quote(symbol: str) -> dict:
    endpoint = f'{BASE}/api/quote-equity?symbol={symbol.upper()}'
    data = None
    last_exc = None

    for _ in range(2):
        s = _session()
        try:
            s.headers.update({'Referer': f'https://www.nseindia.com/get-quotes/equity?symbol={symbol.upper()}'})
            res = s.get(endpoint, timeout=15)
            if res.status_code in {401, 403}:
                # retry with a fresh session/cookies
                last_exc = requests.HTTPError(f'NSE quote HTTP {res.status_code}')
                continue
            res.raise_for_status()
            data = res.json()
            break
        except Exception as exc:
            last_exc = exc

    if data is None:
        raise last_exc or RuntimeError('NSE quote request failed')

    price_info = data.get('priceInfo') or {}
    sec_info = data.get('securityInfo') or {}
    meta = data.get('metadata') or {}

    return {
        'symbol': symbol.upper(),
        'exchange': 'NSE',
        'price': _to_float(price_info.get('lastPrice')),
        'prev_close': _to_float(price_info.get('previousClose')),
        'change_pct': _to_float(price_info.get('pChange')),
        'as_of': sec_info.get('lastUpdateTime') or meta.get('lastUpdateTime') or datetime.utcnow().isoformat(),
    }
