from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class TransactionIn(BaseModel):
    id: str
    user_id: str
    date: date
    script_name: str
    exchange: Literal['NSE', 'BSE'] = 'NSE'
    quantity: float = Field(gt=0)
    price: float = Field(gt=0)
    side: Literal['buy', 'sell'] = 'buy'


class TransactionOut(TransactionIn):
    pass


class QuoteOut(BaseModel):
    symbol: str
    exchange: str
    price: float
    prev_close: float | None = None
    change_pct: float | None = None
    source: str | None = None
    as_of: str


class OptionLeg(BaseModel):
    strike: float
    ltp: float | None = None
    oi: int | None = None
    volume: int | None = None
    iv: float | None = None
    delta: float | None = None
    gamma: float | None = None
    theta: float | None = None
    vega: float | None = None


class OptionRow(BaseModel):
    strike: float
    call: OptionLeg | None = None
    put: OptionLeg | None = None


class OptionsChainOut(BaseModel):
    symbol: str
    spot: float | None = None
    expiry: str | None = None
    source: str | None = None
    rows: list[OptionRow]


class HistoryPoint(BaseModel):
    date: str
    close: float


class OptimizeRequest(BaseModel):
    symbols: list[str]
    exchange: Literal['NSE', 'BSE'] = 'NSE'
    lookback_days: int = 252
    risk_free_rate: float = 0.06


class OptimizeWeight(BaseModel):
    symbol: str
    weight: float


class OptimizeResponse(BaseModel):
    weights: list[OptimizeWeight]
    expected_return: float
    risk: float
    sharpe: float


class BacktestRequest(BaseModel):
    symbols: list[str]
    exchange: Literal['NSE', 'BSE'] = 'NSE'
    start_date: str
    end_date: str


class BacktestPoint(BaseModel):
    date: str
    equity: float


class MfPanExtractRequest(BaseModel):
    user_id: str
    pan: str = Field(min_length=10, max_length=10)
    folio: str | None = None
    source: Literal['auto', 'nsdl', 'cdsl'] = 'auto'
    import_to_portfolio: bool = True


class MfHolding(BaseModel):
    amc: str
    scheme: str
    folio_masked: str
    units: float
    nav: float
    value: float
    as_of: str


class MfPanExtractResponse(BaseModel):
    source: str
    depository: Literal['nsdl', 'cdsl']
    masked_pan: str
    imported_count: int
    holdings: list[MfHolding]
    transactions: list[TransactionOut]


class BrokerSyncRequest(BaseModel):
    user_id: str
    broker: Literal['demo', 'zerodha', 'upstox', 'angelone', 'icici']
    import_to_portfolio: bool = True


class BrokerPosition(BaseModel):
    symbol: str
    exchange: Literal['NSE', 'BSE'] = 'NSE'
    quantity: float
    avg_price: float
    ltp: float | None = None


class BrokerSyncResponse(BaseModel):
    source: str
    broker: str
    imported_count: int
    positions: list[BrokerPosition]
    transactions: list[TransactionOut]


class IntegrationCapabilitiesResponse(BaseModel):
    brokers: list[Literal['demo', 'zerodha', 'upstox', 'angelone', 'icici']]
    mf_sources: list[Literal['auto', 'nsdl', 'cdsl']]
    mode: Literal['simulated', 'hybrid', 'live']
    notes: str


class OAuthStartResponse(BaseModel):
    broker: Literal['zerodha', 'upstox', 'angelone', 'icici']
    mode: Literal['simulated', 'hybrid', 'live']
    auth_url: str
    state: str
    configured: bool


class OAuthCallbackResponse(BaseModel):
    broker: Literal['zerodha', 'upstox', 'angelone', 'icici']
    connected: bool
    token_source: str
    expires_at: str | None = None


class BrokerOAuthStatusResponse(BaseModel):
    broker: Literal['zerodha', 'upstox', 'angelone', 'icici']
    connected: bool
    mode: Literal['simulated', 'hybrid', 'live']
    token_source: str | None = None
    expires_at: str | None = None
    updated_at: str | None = None
