from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "route53.db"
API_TITLE = "Route53 Clone API"
API_VERSION = "2.0.0"

# JWT settings — override SECRET_KEY in production via environment variable
import os
SECRET_KEY: str = os.getenv("SECRET_KEY", "route53-clone-dev-secret-key-change-in-production-abc123xyz")
ALGORITHM: str = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS: int = 7
