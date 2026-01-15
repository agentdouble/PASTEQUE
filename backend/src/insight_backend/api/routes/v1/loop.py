from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....core.config import settings
from ....core.database import get_session
from ....core.security import get_current_user, user_is_admin
from ....models.user import User
from ....repositories.loop_repository import LoopRepository
from ....repositories.data_repository import DataRepository
from ....repositories.user_table_permission_repository import UserTablePermissionRepository
from ....schemas.loop import (
    LoopConfigRequest,
    LoopConfigResponse,
    LoopOverviewResponse,
    LoopSummaryResponse,
    LoopTableOverviewResponse,
)
from ....services.loop_service import LoopService


router = APIRouter(prefix="/loop")


def _service(session: Session) -> LoopService:
    return LoopService(
        repo=LoopRepository(session),
        data_repo=DataRepository(tables_dir=Path(settings.tables_dir)),
    )


@router.get("/overview", response_model=LoopOverviewResponse)
def get_overview(  # type: ignore[valid-type]
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> LoopOverviewResponse:
    service = _service(session)
    allowed = None
    if not user_is_admin(current_user):
        allowed = UserTablePermissionRepository(session).get_allowed_tables(current_user.id)
    overviews = service.get_overview(allowed_tables=allowed)
    items = [
        LoopTableOverviewResponse(
            config=LoopConfigResponse.from_model(config),
            daily=[LoopSummaryResponse.from_model(item) for item in daily],
            weekly=[LoopSummaryResponse.from_model(item) for item in weekly],
            monthly=[LoopSummaryResponse.from_model(item) for item in monthly],
            last_generated_at=config.last_generated_at,
        )
        for config, daily, weekly, monthly in overviews
    ]
    return LoopOverviewResponse(items=items)


@router.put("/config", response_model=LoopConfigResponse)
def update_loop_config(  # type: ignore[valid-type]
    payload: LoopConfigRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> LoopConfigResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin requis")
    service = _service(session)
    config = service.save_config(
        table_name=payload.table_name,
        text_column=payload.text_column,
        date_column=payload.date_column,
    )
    session.commit()
    session.refresh(config)
    return LoopConfigResponse.from_model(config)


@router.post("/regenerate", response_model=LoopOverviewResponse)
def regenerate_loop(  # type: ignore[valid-type]
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    table_name: str | None = None,
) -> LoopOverviewResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin requis")
    service = _service(session)
    service.regenerate(table_name=table_name)
    session.commit()
    overviews = service.get_overview()
    items = [
        LoopTableOverviewResponse(
            config=LoopConfigResponse.from_model(config),
            daily=[LoopSummaryResponse.from_model(item) for item in daily],
            weekly=[LoopSummaryResponse.from_model(item) for item in weekly],
            monthly=[LoopSummaryResponse.from_model(item) for item in monthly],
            last_generated_at=config.last_generated_at,
        )
        for config, daily, weekly, monthly in overviews
    ]
    return LoopOverviewResponse(items=items)
