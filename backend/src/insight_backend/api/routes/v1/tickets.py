from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ....core.config import settings, resolve_project_path
from ....core.database import get_session
from ....core.security import get_current_user, user_is_admin
from ....models.user import User
from ....repositories.data_repository import DataRepository
from ....repositories.user_table_permission_repository import UserTablePermissionRepository
from ....repositories.data_source_preference_repository import DataSourcePreferenceRepository
from ....repositories.ticket_context_repository import TicketContextConfigRepository
from ....services.ticket_context_service import TicketContextService
from ....schemas.tickets import (
    TicketContextConfigRequest,
    TicketContextConfigResponse,
    TicketContextMetadataResponse,
    TicketContextPreviewItem,
    TicketContextPreviewRequest,
)


router = APIRouter(prefix="/tickets")


def _service(session: Session) -> TicketContextService:
    return TicketContextService(
        data_repo=DataRepository(tables_dir=Path(resolve_project_path(settings.tables_dir))),
        data_pref_repo=DataSourcePreferenceRepository(session),
        ticket_config_repo=TicketContextConfigRepository(session),
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


@router.get("/context/config", response_model=TicketContextConfigResponse)
def get_ticket_context_config(  # type: ignore[valid-type]
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> TicketContextConfigResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin requis")
    service = _service(session)
    config = service.get_default_config()
    if not config:
        raise HTTPException(status_code=404, detail="Configuration contexte tickets manquante.")
    return TicketContextConfigResponse.from_model(config)


@router.put("/context/config", response_model=TicketContextConfigResponse)
def update_ticket_context_config(  # type: ignore[valid-type]
    payload: TicketContextConfigRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> TicketContextConfigResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=403, detail="Admin requis")
    service = _service(session)
    config = service.save_default_config(
        table_name=payload.table_name,
        text_column=payload.text_column,
        date_column=payload.date_column,
    )
    pref_repo = DataSourcePreferenceRepository(session)
    existing = pref_repo.get_preferences_for_source(source=payload.table_name)
    updated_pref = pref_repo.set_column_roles(
        source=payload.table_name,
        date_field=payload.date_column,
        category_field=existing.category_field if existing else None,
        sub_category_field=existing.sub_category_field if existing else None,
        ticket_context_fields=payload.ticket_context_fields or [],
    )
    session.commit()
    session.refresh(config)
    return TicketContextConfigResponse.from_model(
        config,
        ticket_context_fields=updated_pref.ticket_context_fields,
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
