# Stock Analyzer Pro

Fresh repo for a stock market analyzer web app.

## Step 1 Delivered

- Portfolio add/delete
- CSV/XLSX upload mapping
- Screener UI
- Options UI
- Backtesting/optimizer baseline
- Google-login-ready auth

## Step 2 Delivered (Current)

- Real backend APIs (FastAPI + SQLAlchemy)
- DB-ready persistence (SQLite default, Postgres-ready via `APP_DATABASE_URL`)
- NSE universe sync from NSE equity master CSV
- Live quotes/history via yfinance
- Live options chain via NSE option-chain endpoint
- True mean-variance max-Sharpe optimizer (covariance matrix + constrained optimization)
- Live backtesting endpoint from real historical data
- Frontend Live Mode switch connected to backend APIs

## Run Frontend

```bash
npm install
npm run dev
```

## Run Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Environment

Create `./.env` (frontend):

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_API_BASE_URL=http://localhost:8000
```

Optional backend env (`backend/.env`):

```bash
APP_DATABASE_URL=sqlite:///./stock_analyzer.db
# or postgres example:
# APP_DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/stockdb
APP_INTEGRATION_MODE=simulated
APP_ENCRYPTION_KEY=change-this-in-production
```

Use `backend/.env.example` for full broker/depository connector variables.

## Broker + MF Connector Stubs (OAuth + Secure Token Storage)

- OAuth endpoints available:
  - `GET /integrations/oauth/{broker}/start?user_id=...`
  - `GET /integrations/oauth/{broker}/callback?state=...&code=...`
  - `GET /integrations/oauth/{broker}/status?user_id=...`
  - `DELETE /integrations/oauth/{broker}/disconnect?user_id=...`
- Token persistence:
  - Stored in `broker_tokens` table
  - Encrypted at rest using key-derived stream encryption + HMAC integrity (`APP_ENCRYPTION_KEY`)
- MF PAN extraction:
  - `POST /integrations/mf/pan-extract` supports `source=auto|nsdl|cdsl`
  - Returns resolved `depository` and connector source label
- Modes:
  - `simulated`: no live provider dependency
  - `hybrid`: connected flow + stub fetchers
  - `live`: requires provider creds configured in backend env

## Step 3 Suggestions

- Replace screener placeholder PE/RSI/volume with provider-backed factors
- Persist transactions server-side per Google user
- Add WebSocket price streaming
- Add strategy builder + transaction-level backtest engine
