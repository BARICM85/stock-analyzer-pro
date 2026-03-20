from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Literal

from ..schemas import BrokerPosition, MfHolding

PAN_RE = re.compile(r'^[A-Z]{5}[0-9]{4}[A-Z]$')
MfSource = Literal['auto', 'nsdl', 'cdsl']


def normalize_pan(raw_pan: str) -> str:
    pan = (raw_pan or '').strip().upper()
    if not PAN_RE.match(pan):
        raise ValueError('Invalid PAN format. Expected 10 chars like ABCDE1234F.')
    return pan


def mask_pan(pan: str) -> str:
    return f'{pan[:3]}XXXX{pan[-3:]}'


def _as_of_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def resolve_mf_source(requested_source: MfSource, pan: str) -> Literal['nsdl', 'cdsl']:
    if requested_source in ('nsdl', 'cdsl'):
        return requested_source
    # Auto mode deterministically maps PAN to a source for consistent local behavior.
    seed = sum(ord(c) for c in pan)
    return 'nsdl' if seed % 2 == 0 else 'cdsl'


def demo_mf_holdings_from_pan(pan: str, source: Literal['nsdl', 'cdsl']) -> list[MfHolding]:
    # Deterministic data from PAN + source so users get stable results in development.
    seed = sum(ord(c) for c in pan)
    as_of = _as_of_today()
    base_units = 120 + (seed % 40)
    source_factor = 1.015 if source == 'nsdl' else 0.985
    return [
        MfHolding(
            amc='SBI Mutual Fund' if source == 'nsdl' else 'HDFC Mutual Fund',
            scheme='SBI Bluechip Fund - Direct Growth',
            folio_masked='XXXXXX1298' if source == 'nsdl' else 'XXXXXX5684',
            units=float(base_units),
            nav=round(82.45 * source_factor, 2),
            value=round(base_units * round(82.45 * source_factor, 2), 2),
            as_of=as_of,
        ),
        MfHolding(
            amc='HDFC Mutual Fund' if source == 'nsdl' else 'ICICI Prudential Mutual Fund',
            scheme='HDFC Flexi Cap Fund - Direct Growth',
            folio_masked='XXXXXX7742' if source == 'nsdl' else 'XXXXXX1129',
            units=float(base_units // 2 + 35),
            nav=round(146.10 * source_factor, 2),
            value=round((base_units // 2 + 35) * round(146.10 * source_factor, 2), 2),
            as_of=as_of,
        ),
        MfHolding(
            amc='ICICI Prudential Mutual Fund' if source == 'nsdl' else 'SBI Mutual Fund',
            scheme='ICICI Prudential Nifty 50 Index Fund - Direct Growth',
            folio_masked='XXXXXX4410' if source == 'nsdl' else 'XXXXXX3321',
            units=float(base_units + 25),
            nav=round(38.70 * source_factor, 2),
            value=round((base_units + 25) * round(38.70 * source_factor, 2), 2),
            as_of=as_of,
        ),
    ]


def simulated_broker_positions(broker: str) -> list[BrokerPosition]:
    # Simulated positions to validate end-to-end sync workflow without broker keys.
    broker = (broker or 'demo').lower()
    if broker == 'zerodha':
        return [
            BrokerPosition(symbol='RELIANCE', exchange='NSE', quantity=14, avg_price=2712.0, ltp=2865.0),
            BrokerPosition(symbol='HDFCBANK', exchange='NSE', quantity=18, avg_price=1515.0, ltp=1598.0),
            BrokerPosition(symbol='SBIN', exchange='NSE', quantity=40, avg_price=732.0, ltp=781.0),
        ]
    if broker == 'upstox':
        return [
            BrokerPosition(symbol='TCS', exchange='NSE', quantity=8, avg_price=3810.0, ltp=4010.0),
            BrokerPosition(symbol='INFY', exchange='NSE', quantity=22, avg_price=1494.0, ltp=1624.0),
            BrokerPosition(symbol='ITC', exchange='NSE', quantity=50, avg_price=431.0, ltp=446.0),
        ]
    if broker == 'angelone':
        return [
            BrokerPosition(symbol='ICICIBANK', exchange='NSE', quantity=20, avg_price=1195.0, ltp=1248.0),
            BrokerPosition(symbol='LT', exchange='NSE', quantity=6, avg_price=3478.0, ltp=3582.0),
            BrokerPosition(symbol='MARUTI', exchange='NSE', quantity=4, avg_price=11920.0, ltp=12170.0),
        ]
    if broker == 'icici':
        return [
            BrokerPosition(symbol='AXISBANK', exchange='NSE', quantity=16, avg_price=1052.0, ltp=1102.0),
            BrokerPosition(symbol='KOTAKBANK', exchange='NSE', quantity=10, avg_price=1720.0, ltp=1784.0),
            BrokerPosition(symbol='BAJFINANCE', exchange='NSE', quantity=5, avg_price=6845.0, ltp=7060.0),
        ]
    return [
        BrokerPosition(symbol='RELIANCE', exchange='NSE', quantity=12, avg_price=2740.0, ltp=2865.0),
        BrokerPosition(symbol='TCS', exchange='NSE', quantity=6, avg_price=3842.0, ltp=4010.0),
        BrokerPosition(symbol='INFY', exchange='NSE', quantity=20, avg_price=1512.0, ltp=1624.0),
    ]


def demo_broker_positions(broker: str) -> list[BrokerPosition]:
    # Backward-compatible alias.
    return simulated_broker_positions(broker)
