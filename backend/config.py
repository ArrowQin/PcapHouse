import os
from typing import List
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "PcapHouse"
    DATABASE_URL: str = "sqlite+aiosqlite:///./pcaphouse.db"
    UPLOAD_DIR: str = os.path.join(os.path.dirname(__file__), "uploads")
    MAX_FILE_SIZE: int = 500 * 1024 * 1024  # 500MB
    ALLOWED_EXTENSIONS: List[str] = [".pcap", ".pcapng", ".cap"]
    SHARKD_PATH: str = "sharkd"
    SHARKD_POOL_SIZE: int = 2
    CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Generator settings
    GENERATOR_TEMP_DIR: str = os.path.join(os.path.dirname(__file__), "tmp_gen")
    TCPREWRITE_PATH: str = "tcprewrite"
    DEFAULT_CLIENT_IP: str = "10.99.1.1"
    DEFAULT_SERVER_IP: str = "10.99.1.2"


settings = Settings()
