import math

from fastapi import APIRouter, Depends, HTTPException
from scipy.stats import norm
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import UniverseStock
from ..schemas import OptionLeg, OptionRow, OptionsChainOut, QuoteOut
from ..services.market_data import fetch_history, fetch_quote
from ..services.nse_client import fetch_nse_universe_csv, fetch_option_chain

router = APIRouter(prefix='/market', tags=['market'])


def _fallback_chain(symbol: str, spot: float) -> list[OptionRow]:
    step = 20 if spot < 1000 else 50
    base = round(spot / step) * step
    rows: list[OptionRow] = []
    for i in range(-8, 9):
        strike = float(base + i * step)
        call_intrinsic = max(spot - strike, 0)
        put_intrinsic = max(strike - spot, 0)
        distance = abs(i)
        call_ltp = round(call_intrinsic + max(8, 28 - distance * 2.4), 2)
        put_ltp = round(put_intrinsic + max(8, 28 - distance * 2.4), 2)
        iv = round(18 + distance * 0.8, 2)
        oi = max(10000, 130000 - distance * 6500)
        rows.append(
            OptionRow(
                strike=strike,
                call=OptionLeg(strike=strike, ltp=call_ltp, oi=oi, volume=max(2000, oi // 10), iv=iv),
                put=OptionLeg(strike=strike, ltp=put_ltp, oi=oi, volume=max(2000, oi // 10), iv=iv),
            )
        )
    return rows


def _bs_greeks(spot: float, strike: float, iv_pct: float, t_years: float = 30 / 365, r: float = 0.06):
    if not spot or not strike or not iv_pct or iv_pct <= 0 or t_years <= 0:
        return None
    sigma = iv_pct / 100.0
    sqrt_t = math.sqrt(t_years)
    if sigma <= 0 or sqrt_t <= 0:
        return None

    d1 = (math.log(spot / strike) + (r + 0.5 * sigma * sigma) * t_years) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t

    pdf_d1 = norm.pdf(d1)
    cdf_d1 = norm.cdf(d1)
    cdf_d2 = norm.cdf(d2)

    call_delta = cdf_d1
    put_delta = cdf_d1 - 1
    gamma = pdf_d1 / (spot * sigma * sqrt_t)
    call_theta = (-(spot * pdf_d1 * sigma) / (2 * sqrt_t) - r * strike * math.exp(-r * t_years) * cdf_d2) / 365
    put_theta = (-(spot * pdf_d1 * sigma) / (2 * sqrt_t) + r * strike * math.exp(-r * t_years) * norm.cdf(-d2)) / 365
    vega = (spot * pdf_d1 * sqrt_t) / 100

    return {
        'call_delta': round(call_delta, 4),
        'put_delta': round(put_delta, 4),
        'gamma': round(gamma, 6),
        'call_theta': round(call_theta, 4),
        'put_theta': round(put_theta, 4),
        'vega': round(vega, 4),
    }


def _enrich_missing_greeks(rows: list[OptionRow], spot: float):
    for row in rows:
        call_iv = row.call.iv if row.call and row.call.iv else None
        put_iv = row.put.iv if row.put and row.put.iv else None
        iv = call_iv if call_iv is not None else put_iv
        g = _bs_greeks(spot=spot, strike=row.strike, iv_pct=iv or 0)
        if not g:
            continue
        if row.call:
            if row.call.delta is None:
                row.call.delta = g['call_delta']
            if row.call.gamma is None:
                row.call.gamma = g['gamma']
            if row.call.theta is None:
                row.call.theta = g['call_theta']
            if row.call.vega is None:
                row.call.vega = g['vega']
        if row.put:
            if row.put.delta is None:
                row.put.delta = g['put_delta']
            if row.put.gamma is None:
                row.put.gamma = g['gamma']
            if row.put.theta is None:
                row.put.theta = g['put_theta']
            if row.put.vega is None:
                row.put.vega = g['vega']


@router.post('/universe/sync')
def sync_universe(db: Session = Depends(get_db)):
    rows = fetch_nse_universe_csv()

    existing = {r.symbol: r for r in db.query(UniverseStock).all()}
    upserts = 0

    for row in rows:
        symbol = row['symbol']
        if symbol in existing:
            existing[symbol].name = row['name']
            existing[symbol].exchange = row['exchange']
        else:
            db.add(UniverseStock(symbol=symbol, name=row['name'], exchange=row['exchange']))
        upserts += 1

    db.commit()
    return {'synced': upserts}


@router.get('/universe')
def list_universe(limit: int = 250, offset: int = 0, db: Session = Depends(get_db)):
    q = db.query(UniverseStock).order_by(UniverseStock.symbol.asc()).offset(offset).limit(limit)
    data = q.all()
    return [{'symbol': r.symbol, 'name': r.name, 'exchange': r.exchange} for r in data]


@router.get('/quote/{symbol}', response_model=QuoteOut)
def quote(symbol: str, exchange: str = 'NSE'):
    try:
        data = fetch_quote(symbol, exchange)
        if data['price'] <= 0:
            raise ValueError('No live price found')
        return data
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'quote_failed: {exc}') from exc


@router.get('/history/{symbol}')
def history(symbol: str, exchange: str = 'NSE', period: str = '1y', interval: str = '1d'):
    try:
        return fetch_history(symbol, exchange, period, interval)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'history_failed: {exc}') from exc


@router.get('/options/{symbol}', response_model=OptionsChainOut)
def options(symbol: str):
    try:
        data = fetch_option_chain(symbol)
        rows = []
        source = 'nse_live'
        for r in data['rows']:
            ce = r.get('ce') or {}
            pe = r.get('pe') or {}
            rows.append(
                OptionRow(
                    strike=float(r['strike']),
                    call=OptionLeg(
                        strike=float(r['strike']),
                        ltp=ce.get('lastPrice'),
                        oi=ce.get('openInterest'),
                        volume=ce.get('totalTradedVolume'),
                        iv=ce.get('impliedVolatility'),
                    ) if ce else None,
                    put=OptionLeg(
                        strike=float(r['strike']),
                        ltp=pe.get('lastPrice'),
                        oi=pe.get('openInterest'),
                        volume=pe.get('totalTradedVolume'),
                        iv=pe.get('impliedVolatility'),
                    ) if pe else None,
                )
            )
        spot = data.get('spot')
        if not spot:
            try:
                q = fetch_quote(symbol, 'NSE')
                spot = q.get('price')
            except Exception:
                spot = None

        # NSE sometimes returns an empty chain due to anti-bot / session behavior.
        # Keep real data when available; otherwise provide a usable fallback chain.
        if not rows and spot:
            rows = _fallback_chain(symbol, float(spot))
            source = 'fallback'
        if rows and spot:
            _enrich_missing_greeks(rows, float(spot))

        return OptionsChainOut(symbol=data['symbol'], spot=spot, expiry=data['expiry'], source=source, rows=rows)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f'options_failed: {exc}') from exc
