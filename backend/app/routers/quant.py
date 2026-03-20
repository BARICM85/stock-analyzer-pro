import numpy as np
from fastapi import APIRouter, HTTPException

from ..schemas import BacktestPoint, BacktestRequest, OptimizeRequest, OptimizeResponse
from ..services.market_data import fetch_history_frame
from ..services.optimizer import optimize_max_sharpe

router = APIRouter(prefix='/quant', tags=['quant'])


@router.post('/optimize', response_model=OptimizeResponse)
def optimize(req: OptimizeRequest):
    symbols = [s.upper() for s in req.symbols if s.strip()]
    if len(symbols) < 2:
        raise HTTPException(status_code=400, detail='Need at least 2 symbols to optimize.')

    prices = fetch_history_frame(symbols, req.exchange, req.lookback_days)
    if prices is None or prices.empty:
        raise HTTPException(status_code=502, detail='No historical data fetched for optimization.')

    prices = prices.dropna(axis=1, how='any')
    if prices.shape[1] < 2:
        raise HTTPException(status_code=502, detail='Insufficient aligned history across symbols.')

    returns = prices.pct_change().dropna()
    result = optimize_max_sharpe(returns.values, list(returns.columns), req.risk_free_rate)
    return OptimizeResponse(**result)


@router.post('/backtest', response_model=list[BacktestPoint])
def backtest(req: BacktestRequest):
    symbols = [s.upper() for s in req.symbols if s.strip()]
    if not symbols:
        raise HTTPException(status_code=400, detail='Need at least one symbol for backtest.')

    prices = fetch_history_frame(symbols, req.exchange, lookback_days=730)
    if prices is None or prices.empty:
        raise HTTPException(status_code=502, detail='No price data for backtest.')

    prices = prices.loc[(prices.index >= req.start_date) & (prices.index <= req.end_date)]
    prices = prices.dropna(axis=1, how='any')
    if prices.empty:
        raise HTTPException(status_code=400, detail='No rows in selected backtest range.')

    weights = np.array([1 / prices.shape[1]] * prices.shape[1])
    returns = prices.pct_change().dropna().values
    equity = 100000.0
    points: list[BacktestPoint] = []

    for i, dt in enumerate(prices.index[1:]):
        daily = float(np.dot(returns[i], weights))
        equity *= (1 + daily)
        points.append(BacktestPoint(date=dt.strftime('%Y-%m-%d'), equity=round(equity, 2)))

    return points
