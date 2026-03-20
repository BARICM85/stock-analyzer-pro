from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import BrokerToken, ConsentAudit, OAuthState, Transaction
from ..schemas import (
    BrokerOAuthStatusResponse,
    BrokerSyncRequest,
    BrokerSyncResponse,
    IntegrationCapabilitiesResponse,
    OAuthCallbackResponse,
    OAuthStartResponse,
    TransactionOut,
)
from ..services.connectors import (
    BrokerName,
    build_broker_authorize_url,
    broker_positions_from_connector,
    exchange_oauth_code_for_token,
    integration_mode,
    oauth_config_for_broker,
)
from ..services.crypto import encrypt_text

router = APIRouter(prefix='/integrations', tags=['integrations'])


def _upsert_transactions(db: Session, rows: list[Transaction]) -> list[TransactionOut]:
    out: list[TransactionOut] = []
    for incoming in rows:
        row = db.query(Transaction).filter(Transaction.id == incoming.id).first()
        if row is None:
            row = Transaction(id=incoming.id)
            db.add(row)
        row.user_id = incoming.user_id
        row.date = incoming.date
        row.script_name = incoming.script_name
        row.exchange = incoming.exchange
        row.quantity = incoming.quantity
        row.price = incoming.price
        row.side = incoming.side
        row.created_at = datetime.utcnow()
        out.append(
            TransactionOut(
                id=row.id,
                user_id=row.user_id,
                date=row.date,
                script_name=row.script_name,
                exchange=row.exchange,
                quantity=row.quantity,
                price=row.price,
                side=row.side,
            )
        )
    db.commit()
    return out


def _audit(
    db: Session,
    user_id: str,
    action: str,
    broker: str | None = None,
    pan_masked: str | None = None,
    status: str = 'accepted',
    meta: str | None = None,
) -> None:
    db.add(
        ConsentAudit(
            user_id=user_id,
            action=action,
            broker=broker,
            pan_masked=pan_masked,
            status=status,
            meta=meta,
        )
    )
    db.commit()


@router.get('/capabilities', response_model=IntegrationCapabilitiesResponse)
def capabilities() -> IntegrationCapabilitiesResponse:
    mode = integration_mode()
    return IntegrationCapabilitiesResponse(
        brokers=['demo', 'zerodha', 'upstox', 'angelone', 'icici'],
        mf_sources=[],
        mode=mode,
        notes='OAuth/token flows are enabled. Broker data fetchers are connector stubs until provider adapters are finalized.',
    )


@router.get('/oauth/{broker}/start', response_model=OAuthStartResponse)
def oauth_start(
    broker: str,
    user_id: str = Query(...),
    db: Session = Depends(get_db),
) -> OAuthStartResponse:
    b = broker.lower()
    if b not in ('zerodha', 'upstox', 'angelone', 'icici'):
        raise HTTPException(status_code=400, detail='Unsupported broker for OAuth.')
    cfg = oauth_config_for_broker(b)  # type: ignore[arg-type]
    if cfg is None:
        raise HTTPException(status_code=400, detail='OAuth is not required for demo broker.')

    mode = integration_mode()
    if mode == 'live' and not cfg.configured:
        raise HTTPException(status_code=400, detail=f'{b} OAuth credentials are not configured in backend env.')

    state = uuid4().hex
    db.add(OAuthState(state=state, user_id=user_id, broker=b))
    db.commit()

    auth_url = build_broker_authorize_url(cfg, state) if cfg.configured else f'{cfg.redirect_uri}?state={state}&code=simulated_code_{state[:10]}'
    return OAuthStartResponse(
        broker=b,  # type: ignore[arg-type]
        mode=mode,
        auth_url=auth_url,
        state=state,
        configured=cfg.configured,
    )


@router.get('/oauth/{broker}/callback', response_model=OAuthCallbackResponse)
def oauth_callback(
    broker: str,
    state: str | None = Query(default=None),
    code: str | None = Query(default=None),
    request_token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    b = broker.lower()
    if b not in ('zerodha', 'upstox', 'angelone', 'icici'):
        raise HTTPException(status_code=400, detail='Unsupported broker callback.')

    state_row = None
    if state:
        state_row = db.query(OAuthState).filter(OAuthState.state == state, OAuthState.broker == b).first()
    elif b == 'zerodha':
        # Zerodha callback may not always echo state in some flows; fallback to latest pending state.
        state_row = (
            db.query(OAuthState)
            .filter(OAuthState.broker == b)
            .order_by(OAuthState.created_at.desc())
            .first()
        )
    if not state_row:
        raise HTTPException(status_code=400, detail='Invalid or expired OAuth state.')

    oauth_code = code or request_token
    if not oauth_code:
        raise HTTPException(status_code=400, detail='Missing OAuth code/request_token in callback.')

    try:
        bundle = exchange_oauth_code_for_token(b, oauth_code, state_row.state)  # type: ignore[arg-type]
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'OAuth token exchange failed: {str(exc)[:180]}') from exc

    if not bundle.access_token:
        raise HTTPException(status_code=400, detail='OAuth token exchange returned empty access token.')

    token_row = (
        db.query(BrokerToken)
        .filter(BrokerToken.user_id == state_row.user_id, BrokerToken.broker == b)
        .first()
    )
    if token_row is None:
        token_row = BrokerToken(user_id=state_row.user_id, broker=b, access_token_enc='')
        db.add(token_row)

    token_row.broker_user_id = bundle.broker_user_id
    token_row.access_token_enc = encrypt_text(bundle.access_token)
    token_row.refresh_token_enc = encrypt_text(bundle.refresh_token) if bundle.refresh_token else None
    token_row.expires_at = bundle.expires_at
    token_row.updated_at = datetime.utcnow()

    db.delete(state_row)
    db.commit()

    _audit(
        db=db,
        user_id=token_row.user_id,
        action='broker_oauth_connect',
        broker=b,
        status='accepted',
        meta=f'token_source={bundle.token_source}',
    )

    expires = bundle.expires_at.isoformat() if bundle.expires_at else ''
    frontend_url = settings.frontend_app_url.rstrip('/')
    return_url = f'{frontend_url}?oauth_done=1&broker={b}&tab=Portfolio'
    html = f"""<!doctype html>
<html>
<head><meta charset="utf-8"><title>Broker Connected</title></head>
<body style="font-family: Arial, sans-serif; padding: 24px;">
  <h2>Broker OAuth Connected</h2>
  <p>Broker: <b>{b}</b></p>
  <p>Token source: <b>{bundle.token_source}</b></p>
  <p>Expires: <b>{expires or 'N/A'}</b></p>
  <p>You can close this window and return to the app.</p>
  <p><a href="{return_url}" style="font-weight: bold;">Return to App</a></p>
  <script>
    try {{
      if (window.opener) {{
        window.opener.postMessage({{ type: 'broker_oauth_done', broker: '{b}' }}, '*');
        setTimeout(() => window.close(), 400);
      }} else {{
        setTimeout(() => {{ window.location.href = '{return_url}'; }}, 1200);
      }}
    }} catch (_) {{}}
  </script>
</body>
</html>"""
    return HTMLResponse(content=html)


@router.get('/oauth/{broker}/status', response_model=BrokerOAuthStatusResponse)
def oauth_status(
    broker: str,
    user_id: str = Query(...),
    db: Session = Depends(get_db),
) -> BrokerOAuthStatusResponse:
    b = broker.lower()
    if b not in ('zerodha', 'upstox', 'angelone', 'icici'):
        raise HTTPException(status_code=400, detail='Unsupported broker.')

    row = db.query(BrokerToken).filter(BrokerToken.user_id == user_id, BrokerToken.broker == b).first()
    mode = integration_mode()
    if not row:
        return BrokerOAuthStatusResponse(
            broker=b,  # type: ignore[arg-type]
            connected=False,
            mode=mode,
        )

    token_source = 'unknown'
    if row.access_token_enc.startswith('djE6') or row.access_token_enc.startswith('v1:'):
        token_source = 'secure_storage'
    expires_at = row.expires_at.isoformat() if row.expires_at else None
    updated_at = row.updated_at.isoformat() if row.updated_at else None
    return BrokerOAuthStatusResponse(
        broker=b,  # type: ignore[arg-type]
        connected=True,
        mode=mode,
        token_source=token_source,
        expires_at=expires_at,
        updated_at=updated_at,
    )


@router.delete('/oauth/{broker}/disconnect')
def oauth_disconnect(
    broker: str,
    user_id: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    b = broker.lower()
    if b not in ('zerodha', 'upstox', 'angelone', 'icici'):
        raise HTTPException(status_code=400, detail='Unsupported broker.')
    row = db.query(BrokerToken).filter(BrokerToken.user_id == user_id, BrokerToken.broker == b).first()
    if row is not None:
        db.delete(row)
        db.commit()
    _audit(db=db, user_id=user_id, action='broker_oauth_disconnect', broker=b, status='accepted')
    return {'broker': b, 'disconnected': True}


@router.post('/broker/sync', response_model=BrokerSyncResponse)
def broker_sync(req: BrokerSyncRequest, db: Session = Depends(get_db)) -> BrokerSyncResponse:
    broker_name: BrokerName = req.broker
    token = None
    if broker_name != 'demo':
        token = (
            db.query(BrokerToken)
            .filter(BrokerToken.user_id == req.user_id, BrokerToken.broker == broker_name)
            .first()
        )
        if token is None and integration_mode() in ('hybrid', 'live'):
            raise HTTPException(
                status_code=400,
                detail=f'{broker_name} is not connected yet. Start OAuth: /integrations/oauth/{broker_name}/start?user_id={req.user_id}',
            )

    try:
        source, positions = broker_positions_from_connector(
            broker_name,
            access_token_enc=token.access_token_enc if token is not None else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    tx_rows: list[Transaction] = []
    if req.import_to_portfolio:
        today = datetime.now(timezone.utc).date()
        for p in positions:
            tx_rows.append(
                Transaction(
                    id=f'broker_{req.user_id}_{broker_name}_{p.symbol}'.lower(),
                    user_id=req.user_id,
                    date=today,
                    script_name=p.symbol,
                    exchange=p.exchange,
                    quantity=p.quantity,
                    price=p.avg_price,
                    side='buy',
                )
            )

    saved = _upsert_transactions(db, tx_rows) if tx_rows else []
    _audit(
        db=db,
        user_id=req.user_id,
        action='broker_sync',
        broker=broker_name,
        status='accepted',
        meta=f'source={source};imported={len(saved)}',
    )
    return BrokerSyncResponse(
        source=source,
        broker=broker_name,
        imported_count=len(saved),
        positions=positions,
        transactions=saved,
    )
