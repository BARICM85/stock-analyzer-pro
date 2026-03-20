from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = 'sqlite:///./stock_analyzer.db'
    nse_timeout_sec: float = 12.0
    market_cache_ttl_sec: int = 20
    integration_mode: str = 'simulated'
    frontend_app_url: str = 'http://localhost:5173'
    encryption_key: str = ''

    zerodha_api_key: str = ''
    zerodha_api_secret: str = ''
    zerodha_redirect_uri: str = 'http://localhost:8000/integrations/oauth/zerodha/callback'
    zerodha_auth_url: str = 'https://kite.zerodha.com/connect/login'
    zerodha_token_url: str = ''

    upstox_client_id: str = ''
    upstox_client_secret: str = ''
    upstox_redirect_uri: str = 'http://localhost:8000/integrations/oauth/upstox/callback'
    upstox_auth_url: str = 'https://api-v2.upstox.com/login/authorization/dialog'
    upstox_token_url: str = 'https://api-v2.upstox.com/login/authorization/token'

    angelone_client_id: str = ''
    angelone_client_secret: str = ''
    angelone_redirect_uri: str = 'http://localhost:8000/integrations/oauth/angelone/callback'
    angelone_auth_url: str = ''
    angelone_token_url: str = ''

    icici_client_id: str = ''
    icici_client_secret: str = ''
    icici_redirect_uri: str = 'http://localhost:8000/integrations/oauth/icici/callback'
    icici_auth_url: str = ''
    icici_token_url: str = ''

    nsdl_api_key: str = ''
    cdsl_api_key: str = ''

    model_config = SettingsConfigDict(env_file='.env', env_prefix='APP_')


settings = Settings()
