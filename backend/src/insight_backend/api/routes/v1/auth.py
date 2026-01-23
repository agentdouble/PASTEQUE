from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....core.database import get_session
from ....core.security import get_current_user, user_is_admin
from ....models.user import User
from ....repositories.user_repository import UserRepository
from ....repositories.user_table_permission_repository import UserTablePermissionRepository
from ....schemas.auth import (
    CreateUserRequest,
    LoginRequest,
    TokenResponse,
    UpdateUserPermissionsRequest,
    UserPermissionsOverviewResponse,
    UserResponse,
    ResetPasswordRequest,
    UserWithPermissionsResponse,
    AdminResetPasswordResponse,
    AdminUsageStatsResponse,
)
from ....services.auth_service import AuthService
from ....services.data_service import DataService


router = APIRouter()


@router.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest, session: Session = Depends(get_session)) -> TokenResponse:
    service = AuthService(UserRepository(session))
    user, token = service.authenticate(username=payload.username, password=payload.password)
    is_admin = user_is_admin(user)
    return TokenResponse(access_token=token, token_type="bearer", username=user.username, is_admin=is_admin)


@router.get("/auth/users", response_model=UserPermissionsOverviewResponse)
async def list_users_with_permissions(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserPermissionsOverviewResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    user_repo = UserRepository(session)
    users = user_repo.list_all()
    data_service = DataService()
    tables = [info.name for info in data_service.list_tables()]

    responses: list[UserWithPermissionsResponse] = []
    for user in users:
        is_admin = user_is_admin(user)
        if is_admin:
            allowed = tables
        else:
            allowed = [perm.table_name for perm in user.table_permissions]
        responses.append(
            UserWithPermissionsResponse.from_model(
                user,
                allowed_tables=allowed,
                is_admin=is_admin,
            )
        )

    return UserPermissionsOverviewResponse(tables=tables, users=responses)


@router.get("/admin/stats", response_model=AdminUsageStatsResponse)
async def get_admin_usage_stats(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AdminUsageStatsResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    repository = UserRepository(session)
    stats = repository.gather_usage_stats()
    return AdminUsageStatsResponse.model_validate(stats)


@router.post("/auth/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: CreateUserRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    service = AuthService(UserRepository(session))
    user = service.create_user(username=payload.username, password=payload.password)
    session.commit()
    session.refresh(user)
    return UserResponse.from_model(user)


@router.put("/auth/users/{username}/table-permissions", response_model=UserWithPermissionsResponse)
async def update_user_table_permissions(
    username: str,
    payload: UpdateUserPermissionsRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserWithPermissionsResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    user_repo = UserRepository(session)
    target = user_repo.get_by_username(username)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user_is_admin(target):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot modify permissions for admin user",
        )

    data_service = DataService()
    available_tables = [info.name for info in data_service.list_tables()]
    available_lookup = {name.casefold() for name in available_tables}
    filtered = [name for name in payload.allowed_tables if name.casefold() in available_lookup]

    permissions_repo = UserTablePermissionRepository(session)
    updated = permissions_repo.set_allowed_tables(target.id, filtered)
    session.commit()
    session.refresh(target)
    return UserWithPermissionsResponse.from_model(
        target,
        allowed_tables=updated,
        is_admin=user_is_admin(target),
    )


@router.post("/auth/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(payload: ResetPasswordRequest, session: Session = Depends(get_session)) -> None:
    service = AuthService(UserRepository(session))
    service.reset_password(
        username=payload.username,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )
    session.commit()


@router.delete("/auth/users/{username}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    username: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    service = AuthService(UserRepository(session))
    service.delete_user(username=username)
    session.commit()


@router.post("/auth/users/{username}/reset-password", response_model=AdminResetPasswordResponse)
async def admin_reset_password(
    username: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AdminResetPasswordResponse:
    if not user_is_admin(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    service = AuthService(UserRepository(session))
    temp = service.admin_reset_password(username=username)
    session.commit()
    return AdminResetPasswordResponse(username=username, temporary_password=temp)
