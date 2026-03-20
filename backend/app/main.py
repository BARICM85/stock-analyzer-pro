from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine
from .routers.integrations import router as integrations_router
from .routers.market import router as market_router
from .routers.portfolio import router as portfolio_router
from .routers.quant import router as quant_router

app = FastAPI(title='Stock Analyzer API', version='0.2.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

Base.metadata.create_all(bind=engine)

app.include_router(market_router)
app.include_router(portfolio_router)
app.include_router(quant_router)
app.include_router(integrations_router)


@app.get('/health')
def health() -> dict:
    return {'status': 'ok', 'version': '0.2.0'}
