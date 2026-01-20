import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings, assert_secure_configuration
from .core.logging import configure_logging
from .core.database import init_database, session_scope
from .api.routes.v1.health import router as health_router
from .api.routes.v1.chat import router as chat_router
from .api.routes.v1.data import router as data_router
from .api.routes.v1.mcp import router as mcp_router
from .api.routes.v1.mindsdb import router as mindsdb_router
from .api.routes.v1.charts import router as charts_router
from .api.routes.v1.conversations import router as conversations_router
from .api.routes.v1.auth import router as auth_router
from .api.routes.v1.feedback import router as feedback_router
from .api.routes.v1.dictionary import router as dictionary_router
from .api.routes.v1.loop import router as loop_router
from .api.routes.v1.tickets import router as tickets_router
from .repositories.user_repository import UserRepository
from .services.auth_service import AuthService


configure_logging(settings.log_level)
log = logging.getLogger("insight.main")


def create_app() -> FastAPI:
    app = FastAPI(title="20_insightv2 API", version="0.1.0")

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers v1
    app.include_router(health_router, prefix=f"{settings.api_prefix}/v1", tags=["health"]) 
    app.include_router(chat_router, prefix=f"{settings.api_prefix}/v1", tags=["chat"]) 
    app.include_router(data_router, prefix=f"{settings.api_prefix}/v1", tags=["data"]) 
    app.include_router(mcp_router, prefix=f"{settings.api_prefix}/v1", tags=["mcp"]) 
    app.include_router(mindsdb_router, prefix=f"{settings.api_prefix}/v1", tags=["mindsdb"])
    app.include_router(charts_router, prefix=f"{settings.api_prefix}/v1", tags=["charts"]) 
    app.include_router(conversations_router, prefix=f"{settings.api_prefix}/v1", tags=["conversations"]) 
    app.include_router(auth_router, prefix=f"{settings.api_prefix}/v1", tags=["auth"]) 
    app.include_router(feedback_router, prefix=f"{settings.api_prefix}/v1", tags=["feedback"])
    app.include_router(dictionary_router, prefix=f"{settings.api_prefix}/v1", tags=["dictionary"])
    app.include_router(loop_router, prefix=f"{settings.api_prefix}/v1", tags=["loop"])
    app.include_router(tickets_router, prefix=f"{settings.api_prefix}/v1", tags=["tickets"])

    @app.on_event("startup")
    def _startup() -> None:
        # Harden: block unsafe defaults outside development
        assert_secure_configuration()
        # Always log/validate agent caps visibility on startup
        settings.validate_agent_limits_startup()
        # Warn about deprecated env vars for cleanup
        settings.warn_deprecated_env()
        init_database()
        with session_scope() as session:
            created = AuthService(UserRepository(session)).ensure_admin_user(
                settings.admin_username,
                settings.admin_password,
            )
            if created:
                log.info("Default admin user created: %s", settings.admin_username)

    return app


app = create_app()
