from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
from typing import Literal
from urllib.parse import urlencode

import requests

from ..config import settings
from ..schemas import BrokerPosition
from .crypto import decrypt_text
from .integrations import demo_mf_holdings_from_pan, simulated_broker_positions

BrokerName = Literal['demo', 'zerodha', 'upstox', 'angelone', 'icici']
DepositoryName = Literal['nsdl', 'cdsl']


@dataclass
class OAuthBrokerConfig:
    broker: BrokerName
    client_id: str
    client_secret: str
    redirect_uri: str
    auth_url: str
    token_url: str
    scope: str = 'portfolio'

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret and self.redirect_uri and self.auth_url)


@dataclass
class OAuthTokenBundle:
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    broker_user_id: str | None
    token_source: str


def integration_mode() -> Literal['simulated', 'hybrid', 'live']:
    raw = (settings.integration_mode or 'simulated').strip().lower()
    if raw in ('simulated', 'hybrid', 'live'):
        return raw
    return 'simulated'


def oauth_config_for_broker(broker: BrokerName) -> OAuthBrokerConfig | None:
    if broker == 'demo':
        return None
    if broker == 'zerodha':
        return OAuthBrokerConfig(
            broker='zerodha',
            client_id=settings.zerodha_api_key,
            client_secret=settings.zerodha_api_secret,
            redirect_uri=settings.zerodha_redirect_uri,
            auth_url=settings.zerodha_auth_url,
            token_url=settings.zerodha_token_url,
            scope='orders holdings profile',
        )
    if broker == 'upstox':
        return OAuthBrokerConfig(
            broker='upstox',
            client_id=settings.upstox_client_id,
            client_secret=settings.upstox_client_secret,
            redirect_uri=settings.upstox_redirect_uri,
            auth_url=settings.upstox_auth_url,
            token_url=settings.upstox_token_url,
            scope='portfolio',
        )
    if broker == 'angelone':
        return OAuthBrokerConfig(
            broker='angelone',
            client_id=settings.angelone_client_id,
            client_secret=settings.angelone_client_secret,
            redirect_uri=settings.angelone_redirect_uri,
            auth_url=settings.angelone_auth_url,
            token_url=settings.angelone_token_url,
            scope='portfolio',
        )
    return OAuthBrokerConfig(
        broker='icici',
        client_id=settings.icici_client_id,
        client_secret=settings.icici_client_secret,
        redirect_uri=settings.icici_redirect_uri,
        auth_url=settings.icici_auth_url,
        token_url=settings.icici_token_url,
        scope='portfolio',
    )


def build_broker_authorize_url(config: OAuthBrokerConfig, state: str) -> str:
    if config.broker == 'zerodha':
        query = urlencode(
            {
                'api_key': config.client_id,
                'v': '3',
                'state': state,
            }
        )
        return f'{config.auth_url}?{query}'

    query = urlencode(
        {
            'response_type': 'code',
            'client_id': config.client_id,
            'redirect_uri': config.redirect_uri,
            'scope': config.scope,
            'state': state,
        }
    )
    return f'{config.auth_url}?{query}'


def exchange_oauth_code_for_token(broker: BrokerName, code: str, state: str) -> OAuthTokenBundle:
    cfg = oauth_config_for_broker(broker)
    mode = integration_mode()
    if cfg is None:
        raise ValueError('OAuth is not required for demo broker.')

    if broker == 'zerodha' and cfg.configured and mode in ('hybrid', 'live'):
        checksum = hashlib.sha256(f'{cfg.client_id}{code}{cfg.client_secret}'.encode('utf-8')).hexdigest()
        token_url = cfg.token_url or 'https://api.kite.trade/session/token'
        payload = {
            'api_key': cfg.client_id,
            'request_token': code,
            'checksum': checksum,
        }
        try:
            response = requests.post(token_url, data=payload, timeout=20)
            response.raise_for_status()
            data = response.json().get('data', {})
            expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
            return OAuthTokenBundle(
                access_token=str(data.get('access_token') or ''),
                refresh_token=None,
                expires_at=expires_at,
                broker_user_id=str(data.get('user_id')) if data.get('user_id') else None,
                token_source='live',
            )
        except Exception as exc:
            raise ValueError(f'Zerodha token exchange failed: {str(exc)[:220]}') from exc

    if mode == 'live':
        if not cfg.configured or not cfg.token_url:
            raise ValueError(f'{broker} OAuth is not fully configured in backend environment.')
        payload = {
            'grant_type': 'authorization_code',
            'code': code,
            'client_id': cfg.client_id,
            'client_secret': cfg.client_secret,
            'redirect_uri': cfg.redirect_uri,
        }
        response = requests.post(cfg.token_url, data=payload, timeout=20)
        response.raise_for_status()
        data = response.json()
        expires_in = data.get('expires_in')
        expires_at = None
        if isinstance(expires_in, (int, float)):
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
        return OAuthTokenBundle(
            access_token=str(data.get('access_token') or ''),
            refresh_token=str(data.get('refresh_token')) if data.get('refresh_token') else None,
            expires_at=expires_at,
            broker_user_id=str(data.get('user_id')) if data.get('user_id') else None,
            token_source='live',
        )

    # Simulated/hybrid bootstrap token for development.
    expires_at = datetime.now(timezone.utc) + timedelta(hours=12)
    return OAuthTokenBundle(
        access_token=f'sim_access_{broker}_{state[-8:]}_{code[-6:]}',
        refresh_token=f'sim_refresh_{broker}_{state[:8]}',
        expires_at=expires_at,
        broker_user_id=f'{broker}_user_{state[:6]}',
        token_source='simulated',
    )


def _fetch_zerodha_holdings(access_token: str) -> list[BrokerPosition]:
    if not settings.zerodha_api_key.strip():
        raise ValueError('Zerodha API key is missing in backend config.')
    headers = {
        'X-Kite-Version': '3',
        'Authorization': f'token {settings.zerodha_api_key}:{access_token}',
    }
    response = requests.get('https://api.kite.trade/portfolio/holdings', headers=headers, timeout=20)
    response.raise_for_status()
    payload = response.json()
    data = payload.get('data') or []
    out: list[BrokerPosition] = []
    for row in data:
        symbol = str(row.get('tradingsymbol') or '').strip().upper()
        if not symbol:
            continue
        exch = str(row.get('exchange') or 'NSE').upper()
        exchange: Literal['NSE', 'BSE'] = 'BSE' if exch == 'BSE' else 'NSE'
        qty = float(row.get('quantity') or 0)
        if qty <= 0:
            continue
        avg = float(row.get('average_price') or 0)
        ltp = row.get('last_price')
        out.append(
            BrokerPosition(
                symbol=symbol,
                exchange=exchange,
                quantity=qty,
                avg_price=avg,
                ltp=float(ltp) if ltp is not None else None,
            )
        )
    return out


def broker_positions_from_connector(broker: BrokerName, access_token_enc: str | None) -> tuple[str, list]:
    mode = integration_mode()
    if broker == 'demo':
        return 'simulated_demo', simulated_broker_positions(broker)
    if not access_token_enc:
        return 'simulated_no_token', simulated_broker_positions(broker)
    if broker == 'zerodha':
        access_token = decrypt_text(access_token_enc)
        if access_token.startswith('sim_access_'):
            raise ValueError('Zerodha is connected with a simulated token. Reconnect OAuth to fetch real holdings.')
        try:
            positions = _fetch_zerodha_holdings(access_token)
        except Exception as exc:
            raise ValueError(f'Zerodha holdings fetch failed: {str(exc)[:220]}') from exc
        return 'live_zerodha', positions
    if mode == 'live':
        return f'live_stub_{broker}', simulated_broker_positions(broker)
    if mode == 'hybrid':
        return f'hybrid_stub_{broker}', simulated_broker_positions(broker)
    return f'simulated_{broker}', simulated_broker_positions(broker)


def depository_ready(depository: DepositoryName) -> bool:
    if depository == 'nsdl':
        return bool(settings.nsdl_api_key.strip())
    return bool(settings.cdsl_api_key.strip())


def mf_holdings_from_connector(pan: str, depository: DepositoryName) -> tuple[str, list]:
    mode = integration_mode()
    if mode == 'live' and not depository_ready(depository):
        raise ValueError(f'{depository.upper()} connector is not configured in backend environment.')
    if mode == 'hybrid' and depository_ready(depository):
        return f'hybrid_stub_{depository}', demo_mf_holdings_from_pan(pan, depository)
    if mode == 'live':
        return f'live_stub_{depository}', demo_mf_holdings_from_pan(pan, depository)
    return f'simulated_{depository}', demo_mf_holdings_from_pan(pan, depository)
