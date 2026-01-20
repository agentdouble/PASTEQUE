from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ....core.config import settings, resolve_project_path
from ....core.database import get_session
from ....core.security import get_current_user, user_is_admin
from ....models.user import User
from ....repositories.loop_repository import LoopRepository
from ....repositories.data_repository import DataRepository
from ....repositories.user_table_permission_repository import UserTablePermissionRepository
from ....repositories.data_source_preference_repository import DataSourcePreferenceRepository
from ....services.ticket_context_service import TicketContextService
from ....schemas.tickets import (
    TicketContextMetadataResponse,
    TicketContextPreviewItem,
    TicketContextPreviewRequest,
)


router = APIRouter(prefix="/tickets")


def _service(session: Session) -> TicketContextService:
    return TicketContextService(
        loop_repo=LoopRepository(session),
        data_repo=DataRepository(tables_dir=Path(resolve_project_path(settings.tables_dir))),
        data_pref_repo=DataSourcePreferenceRepository(session),
    )


@router.get("/context/metadata", response_model=TicketContextMetadataResponse)
def get_ticket_context_metadata(  # type: ignore[valid-type]
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    table: str | None = None,
    text_column: str | None = None,
    date_column: str | None = None,
) -> TicketContextMetadataResponse:
    allowed_tables = None
    if not user_is_admin(current_user):
        allowed_tables = UserTablePermissionRepository(session).get_allowed_tables(current_user.id)
    service = _service(session)
    meta = service.get_metadata(
        allowed_tables=allowed_tables,
        table=table,
        text_column=text_column,
        date_column=date_column,
    )
    return TicketContextMetadataResponse(
        table=meta["table"],
        text_column=meta["text_column"],
        date_column=meta["date_column"],
        date_min=meta["date_min"],
        date_max=meta["date_max"],
        total_count=meta["total_count"],
    )


@router.post("/context/preview", response_model=list[TicketContextPreviewItem])
def preview_ticket_context(  # type: ignore[valid-type]
    payload: TicketContextPreviewRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[TicketContextPreviewItem]:
    allowed_tables = None
    if not user_is_admin(current_user):
        allowed_tables = UserTablePermissionRepository(session).get_allowed_tables(current_user.id)
    service = _service(session)
    if not payload.sources:
        raise HTTPException(status_code=400, detail="Aucune source de tickets fournie.")
    items: list[TicketContextPreviewItem] = []
    for src in payload.sources:
        periods = [p.model_dump(by_alias=True) for p in (src.periods or [])] or None
        try:
            preview = service.build_preview(
                allowed_tables=allowed_tables,
                date_from=None,
                date_to=None,
                periods=periods,
                table=src.table,
                text_column=src.text_column,
                date_column=src.date_column,
            )
            items.append(TicketContextPreviewItem(**preview))
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            items.append(TicketContextPreviewItem(table=src.table, error=detail))
    return items
