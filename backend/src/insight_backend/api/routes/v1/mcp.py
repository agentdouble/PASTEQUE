from fastapi import APIRouter, HTTPException

from ....integrations.mcp_manager import MCPManager
from ....schemas.mcp_chart import ChartRequest, ChartResponse
from ....services.mcp_chart_service import ChartGenerationError, ChartGenerationService
from ....core.agent_limits import reset_from_settings, AgentBudgetExceeded


router = APIRouter(prefix="/mcp")


@router.get("/servers")
def list_mcp_servers() -> list[dict]:  # type: ignore[valid-type]
    mgr = MCPManager()
    return [
        {"name": s.name, "command": s.command, "args": s.args, "env": list(s.env.keys())}
        for s in mgr.list_servers()
    ]


@router.post("/chart", response_model=ChartResponse)
async def generate_mcp_chart(payload: ChartRequest) -> ChartResponse:  # type: ignore[valid-type]
    # Initialize per-request agent budgets from settings
    reset_from_settings()
    service = ChartGenerationService()
    try:
        result = await service.generate_chart(
            prompt=payload.prompt,
            dataset=payload.dataset,
            answer=payload.answer,
        )
    except AgentBudgetExceeded as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except ChartGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return ChartResponse(
        prompt=result.prompt,
        chart_url=result.chart_url,
        tool_name=result.tool_name,
        chart_title=result.chart_title,
        chart_description=result.chart_description,
        chart_spec=result.chart_spec,
        source_sql=result.source_sql,
        source_row_count=result.source_row_count,
    )
