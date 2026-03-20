from sqlalchemy import Column, Date, DateTime, Float, Integer, String, func

from .database import Base


class Transaction(Base):
    __tablename__ = 'transactions'

    id = Column(String(64), primary_key=True, index=True)
    user_id = Column(String(128), index=True, nullable=False)
    date = Column(Date, nullable=False)
    script_name = Column(String(32), index=True, nullable=False)
    exchange = Column(String(8), nullable=False)
    quantity = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    side = Column(String(8), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class UniverseStock(Base):
    __tablename__ = 'universe_stocks'

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(32), unique=True, index=True, nullable=False)
    name = Column(String(255), nullable=False)
    exchange = Column(String(8), nullable=False, default='NSE')
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class BrokerToken(Base):
    __tablename__ = 'broker_tokens'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(128), index=True, nullable=False)
    broker = Column(String(32), index=True, nullable=False)
    broker_user_id = Column(String(128), nullable=True)
    access_token_enc = Column(String(4096), nullable=False)
    refresh_token_enc = Column(String(4096), nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class OAuthState(Base):
    __tablename__ = 'oauth_states'

    state = Column(String(128), primary_key=True, index=True)
    user_id = Column(String(128), index=True, nullable=False)
    broker = Column(String(32), index=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class ConsentAudit(Base):
    __tablename__ = 'consent_audits'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(128), index=True, nullable=False)
    action = Column(String(64), nullable=False)
    broker = Column(String(32), nullable=True)
    pan_masked = Column(String(16), nullable=True)
    status = Column(String(16), nullable=False, default='accepted')
    meta = Column(String(1024), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
