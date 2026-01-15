from functools import lru_cache
from typing import List
import logging
import json

from pydantic import Field
from pydantic import field_validator
from pydantic import ValidationInfo
from pydantic_settings import BaseSettings, SettingsConfigDict
import os


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        case_sensitive=False,
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
    env: str = Field("development", alias="ENV")
    api_prefix: str = Field("/api", alias="API_PREFIX")
    log_level: str = Field("INFO", alias="LOG_LEVEL")
    allowed_origins_raw: str | None = Field(None, alias="ALLOWED_ORIGINS")
    # UI animation mode: 'sql' keeps current SQL/plan events, 'true' adds an animator agent,
    # 'false' suppresses SQL/plan streaming (keeps essential meta/evidence only)
    animation_mode: str = Field("sql", alias="ANIMATION")  # "sql" | "true" | "false"

    data_root: str = Field("../data", alias="DATA_ROOT")
    vector_store_path: str = Field("../data/vector_store", alias="VECTOR_STORE_PATH")
    tables_dir: str = Field("../data", alias="DATA_TABLES_DIR")
    # Default path fixed: 'dictionary' (not 'dictionnary')
    data_dictionary_dir: str = Field("../data/dictionary", alias="DATA_DICTIONARY_DIR")
    # Cap for injected data dictionary JSON in prompts
    data_dictionary_max_chars: int = Field(6000, alias="DATA_DICTIONARY_MAX_CHARS")

    # LLM configuration
    llm_mode: str = Field("local", alias="LLM_MODE")  # "local" | "api"
    # OpenAI-compatible (API provider Z or others)
    openai_base_url: str | None = Field(None, alias="OPENAI_BASE_URL")
    openai_api_key: str | None = Field(None, alias="OPENAI_API_KEY")
    llm_verify_ssl: bool = Field(True, alias="LLM_VERIFY_SSL")
    llm_model: str | None = Field(None, alias="LLM_MODEL")
    openai_timeout_s: int = Field(90, alias="OPENAI_TIMEOUT_S")
    llm_max_tokens: int = Field(1024, alias="LLM_MAX_TOKENS")
    # vLLM local
    vllm_base_url: str | None = Field("http://localhost:8000/v1", alias="VLLM_BASE_URL")
    z_local_model: str | None = Field("GLM-4.5-Air", alias="Z_LOCAL_MODEL")
    embedding_model: str | None = Field(None, alias="EMBEDDING_MODEL")
    embedding_mode: str = Field("api", alias="EMBEDDING_MODE")  # "local" | "api"
    embedding_local_model: str | None = Field(
        "sentence-transformers/all-MiniLM-L6-v2",
        alias="EMBEDDING_LOCAL_MODEL",
    )

    # Retrieval agent tuning
    retrieval_model: str | None = Field(None, alias="RETRIEVAL_MODEL")
    retrieval_temperature: float = Field(0.2, alias="RETRIEVAL_TEMPERATURE")
    retrieval_max_tokens: int = Field(220, alias="RETRIEVAL_MAX_TOKENS")
    retrieval_inject_analyst: bool = Field(True, alias="RETRIEVAL_INJECT_ANALYST")

    # Loop (résumés hebdo/mensuels)
    loop_max_tickets: int = Field(60, alias="LOOP_MAX_TICKETS")
    loop_ticket_text_max_chars: int = Field(360, alias="LOOP_TICKET_TEXT_MAX_CHARS")
    loop_max_days: int = Field(1, alias="LOOP_MAX_DAYS")
    loop_max_weeks: int = Field(1, alias="LOOP_MAX_WEEKS")
    loop_max_months: int = Field(1, alias="LOOP_MAX_MONTHS")
    loop_temperature: float = Field(0.3, alias="LOOP_TEMPERATURE")
    loop_max_tokens: int = Field(800, alias="LOOP_MAX_TOKENS")
    loop_max_tickets_per_call: int = Field(400, alias="LOOP_MAX_TICKETS_PER_CALL")
    loop_max_input_chars: int = Field(300000, alias="LOOP_MAX_INPUT_CHARS")

    # Router gate (applied on every user message)
    router_mode: str = Field("rule", alias="ROUTER_MODE")  # "rule" | "local" | "api" | "false"
    router_model: str | None = Field(None, alias="ROUTER_MODEL")

    # Agent request caps (JSON mapping: {agent_name: max_requests})
    agent_max_requests_json: str | None = Field(None, alias="AGENT_MAX_REQUESTS")

    @field_validator("router_mode", mode="before")
    @classmethod
    def _validate_router_mode(cls, v: str | None) -> str:
        val = (v or "rule").strip().lower()
        valid = {"rule", "local", "api", "false"}
        if val not in valid:
            raise ValueError(f"ROUTER_MODE must be one of {sorted(valid)}; got: {v!r}")
        return val

    @field_validator("animation_mode", mode="before")
    @classmethod
    def _validate_animation_mode(cls, v: str | None) -> str:
        val = (v or "sql").strip().lower()
        valid = {"sql", "true", "false"}
        if val not in valid:
            raise ValueError(f"ANIMATION must be one of {sorted(valid)}; got: {v!r}")
        return val

    @field_validator("embedding_mode", mode="before")
    @classmethod
    def _validate_embedding_mode(cls, v: str | None) -> str:
        val = (v or "api").strip().lower()
        if val not in {"local", "api"}:
            raise ValueError("EMBEDDING_MODE must be 'local' or 'api'")
        return val

    # MCP configuration (declarative)
    mcp_config_path: str | None = Field("../plan/Z/mcp.config.json", alias="MCP_CONFIG_PATH")
    mcp_servers_json: str | None = Field(None, alias="MCP_SERVERS_JSON")

    # MindsDB (HTTP API)
    mindsdb_base_url: str = Field("http://127.0.0.1:47334/api", alias="MINDSDB_BASE_URL")
    mindsdb_token: str | None = Field(None, alias="MINDSDB_TOKEN")
    mindsdb_embeddings_config_path: str | None = Field(None, alias="MINDSDB_EMBEDDINGS_CONFIG_PATH")
    mindsdb_embedding_batch_size: int = Field(16, alias="MINDSDB_EMBEDDING_BATCH_SIZE")
    mindsdb_timeout_s: float = Field(120.0, alias="MINDSDB_TIMEOUT_S")
    rag_top_n: int = Field(3, alias="RAG_TOP_N")
    rag_table_row_cap: int = Field(500, alias="RAG_TABLE_ROW_CAP")
    rag_max_columns: int = Field(6, alias="RAG_MAX_COLUMNS")

    # Evidence panel / dataset defaults
    evidence_limit_default: int = Field(100, alias="EVIDENCE_LIMIT_DEFAULT")
    agent_output_max_rows: int = Field(200, alias="AGENT_OUTPUT_MAX_ROWS")
    agent_output_max_columns: int = Field(20, alias="AGENT_OUTPUT_MAX_COLUMNS")

    # Exclusions / validation caps
    max_excluded_tables: int = Field(1000, alias="MAX_EXCLUDED_TABLES")
    max_table_name_length: int = Field(255, alias="MAX_TABLE_NAME_LENGTH")
    settings_update_min_interval_s: float = Field(2.0, alias="SETTINGS_UPDATE_MIN_INTERVAL_S")

    @field_validator("mindsdb_embedding_batch_size")
    @classmethod
    def _validate_embedding_batch(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("MINDSDB_EMBEDDING_BATCH_SIZE must be > 0")
        return v

    @field_validator("rag_top_n", "rag_table_row_cap", "rag_max_columns")
    @classmethod
    def _validate_positive_int(cls, v: int, info: ValidationInfo) -> int:
        if v <= 0:
            raise ValueError(f"{info.field_name.upper()} must be > 0")
        return v

    @field_validator("retrieval_temperature")
    @classmethod
    def _validate_retrieval_temperature(cls, v: float) -> float:
        # Keep permissive range; typical OpenAI range is [0,2]
        if v < 0:
            raise ValueError("RETRIEVAL_TEMPERATURE must be >= 0")
        return float(v)

    @field_validator("loop_temperature")
    @classmethod
    def _validate_loop_temperature(cls, v: float) -> float:
        if v < 0:
            raise ValueError("LOOP_TEMPERATURE must be >= 0")
        return float(v)

    @field_validator("retrieval_max_tokens")
    @classmethod
    def _validate_retrieval_max_tokens(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("RETRIEVAL_MAX_TOKENS must be > 0")
        return int(v)

    @field_validator("loop_max_tickets", "loop_max_days", "loop_max_weeks", "loop_max_months", "loop_max_tokens")
    @classmethod
    def _validate_loop_positive_ints(cls, v: int, info: ValidationInfo) -> int:
        if v <= 0:
            raise ValueError(f"{info.field_name.upper()} must be > 0")
        return int(v)

    @field_validator("llm_max_tokens")
    @classmethod
    def _validate_llm_max_tokens(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("LLM_MAX_TOKENS must be > 0")
        return int(v)

    @field_validator("agent_output_max_rows", "agent_output_max_columns")
    @classmethod
    def _validate_agent_output_caps(cls, v: int, info: ValidationInfo) -> int:
        if v <= 0:
            raise ValueError(f"{info.field_name.upper()} must be > 0")
        return int(v)

    # Database
    database_url: str = Field(
        "postgresql+psycopg://postgres:postgres@localhost:5432/pasteque",
        alias="DATABASE_URL",
    )

    # Authentication
    jwt_secret_key: str = Field("change-me", alias="JWT_SECRET_KEY")
    jwt_algorithm: str = Field("HS256", alias="JWT_ALGORITHM")
    jwt_expiration_minutes: int = Field(240, alias="JWT_EXPIRATION_MINUTES")
    admin_username: str = Field("admin", alias="ADMIN_USERNAME")
    admin_password: str = Field("admin", alias="ADMIN_PASSWORD")

    # NL→SQL generation (always enabled; env switch removed)
    nl2sql_db_prefix: str = Field("files", alias="NL2SQL_DB_PREFIX")
    # Sample injection removed; explorer agent handles data probing
    # Removed nl2sql plan mode (redundant with multi-agent)

    # NL→SQL multi‑agent (always enabled)
    nl2sql_satisfaction_min_rows: int = Field(1, alias="NL2SQL_SATISFACTION_MIN_ROWS")

    @property
    def allowed_origins(self) -> List[str]:
        if self.allowed_origins_raw:
            return [item.strip() for item in self.allowed_origins_raw.split(",") if item.strip()]
        return ["http://localhost:5173"]

    @property
    def agent_max_requests(self) -> dict[str, int]:
        """Parse AGENT_MAX_REQUESTS env (JSON) into a {agent: cap} dict.

        Invalid or missing values yield an empty mapping. Non-positive caps
        are ignored. Keys are normalized as str.
        """
        raw = self.agent_max_requests_json
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except Exception:
            logging.getLogger("insight.core.config").warning(
                "Invalid AGENT_MAX_REQUESTS JSON; ignoring."
            )
            return {}
        out: dict[str, int] = {}
        if isinstance(data, dict):
            for k, v in data.items():
                try:
                    n = int(v)
                except Exception:
                    continue
                # Accept 0 to explicitly disable an agent
                if n >= 0:
                    out[str(k)] = n
        return out

    def validate_agent_limits_startup(self) -> None:
        """Validate AGENT_MAX_REQUESTS on startup and emit clear logs.

        - In non-development environments, invalid JSON raises at startup.
        - Always log an INFO line summarizing the effective caps (or absence).
        """
        log = logging.getLogger("insight.core.config")
        env = (self.env or "").strip().lower()
        raw = self.agent_max_requests_json
        caps = self.agent_max_requests
        if raw and not caps:
            # Ambiguous: it can be invalid JSON or a mapping with no usable positive values
            # Disambiguate by attempting a strict parse here
            try:
                _ = json.loads(raw)
            except Exception:
                if env not in {"dev", "development", "local"}:
                    raise RuntimeError("Invalid AGENT_MAX_REQUESTS JSON in production environment")
                # In dev, we already warned in agent_max_requests; continue
        if caps:
            log.info("Agent caps active: %s", caps)
        else:
            log.info("No agent caps configured (AGENT_MAX_REQUESTS unset or empty)")

    def warn_deprecated_env(self) -> None:
        """Emit warnings for deprecated environment variables now ignored.

        This helps operators clean up configs after the NL→SQL simplification.
        """
        deprecated = [
            "NL2SQL_ENABLED",
            "NL2SQL_INCLUDE_SAMPLES",
            "NL2SQL_SAMPLES_PATH",
            "NL2SQL_PLAN_MODE",
        ]
        present = [k for k in deprecated if os.getenv(k) is not None]
        if present:
            logging.getLogger("insight.core.config").warning(
                "Deprecated env vars detected and ignored: %s",
                present,
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[arg-type]


settings = get_settings()


def assert_secure_configuration() -> None:
    """Fail fast in non-development envs when unsafe defaults are detected.

    This preserves developer ergonomics (defaults are allowed in ENV=development)
    while preventing accidental production runs with insecure credentials.
    """
    log = logging.getLogger("insight.core.config")
    env = (settings.env or "").strip().lower()
    if env in {"dev", "development", "local"}:
        # Be noisy but do not block developer workflows
        if settings.jwt_secret_key == "change-me":
            log.warning("Using default JWT secret in development; DO NOT use in production.")
        if settings.admin_password == "admin":
            log.warning("Using default admin password in development; DO NOT use in production.")
        if "postgres:postgres@" in settings.database_url:
            log.warning("Using default Postgres credentials in development; DO NOT use in production.")
        return

    # Harden non-development environments
    problems: list[str] = []
    if settings.jwt_secret_key == "change-me":
        problems.append("JWT_SECRET_KEY must be set to a strong secret")
    if settings.admin_password == "admin":
        problems.append("ADMIN_PASSWORD must not be 'admin'")
    if "postgres:postgres@" in settings.database_url:
        problems.append("DATABASE_URL must not use default 'postgres:postgres' credentials")

    if problems:
        raise RuntimeError(
            "Insecure configuration detected for ENV!='development': " + "; ".join(problems)
        )

def resolve_project_path(p: str) -> str:
    """Resolve ``p`` to an absolute path relative to the backend directory when needed.

    - If ``p`` est absolu, on le retourne tel quel.
    - Si ``p`` est relatif, on l'ancre au dossier backend (parents[3] depuis ce fichier),
      ce qui correspond à la racine du projet (contenant `backend/`, `data/`, `frontend/`, etc.).
    """
    from pathlib import Path as _Path  # local import to keep public surface minimal

    raw = _Path(p)
    if raw.is_absolute():
        return str(raw)
    base = _Path(__file__).resolve().parents[3]  # …/backend
    return str((base / raw).resolve())
