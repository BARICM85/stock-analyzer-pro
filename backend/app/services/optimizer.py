from __future__ import annotations

import numpy as np
from scipy.optimize import minimize


def optimize_max_sharpe(returns_matrix, symbols: list[str], risk_free_rate: float = 0.06):
    if returns_matrix.shape[1] == 0:
        return {'weights': [], 'expected_return': 0.0, 'risk': 0.0, 'sharpe': 0.0}

    # daily -> annualized
    mean_ret = returns_matrix.mean(axis=0) * 252
    cov = np.cov(returns_matrix.T) * 252
    n = len(symbols)

    def neg_sharpe(w):
      port_ret = float(np.dot(w, mean_ret))
      port_vol = float(np.sqrt(np.dot(w.T, np.dot(cov, w))))
      if port_vol == 0:
          return 1e6
      return -((port_ret - risk_free_rate) / port_vol)

    cons = ({'type': 'eq', 'fun': lambda w: np.sum(w) - 1.0},)
    bounds = tuple((0.0, 1.0) for _ in range(n))
    x0 = np.array([1.0 / n] * n)

    res = minimize(neg_sharpe, x0=x0, method='SLSQP', bounds=bounds, constraints=cons)
    w = res.x if res.success else x0

    port_ret = float(np.dot(w, mean_ret))
    port_vol = float(np.sqrt(np.dot(w.T, np.dot(cov, w))))
    sharpe = (port_ret - risk_free_rate) / port_vol if port_vol > 0 else 0.0

    return {
        'weights': [{'symbol': symbols[i], 'weight': float(round(w[i] * 100, 4))} for i in range(n)],
        'expected_return': float(round(port_ret * 100, 4)),
        'risk': float(round(port_vol * 100, 4)),
        'sharpe': float(round(sharpe, 6)),
    }
