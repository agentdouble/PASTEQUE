from pydantic import BaseModel, Field


class PromptItem(BaseModel):
    key: str
    label: str
    description: str | None = None
    template: str
    placeholders: list[str] = Field(default_factory=list)
    allowed_variables: list[str] = Field(default_factory=list)


class PromptsResponse(BaseModel):
    version: int
    prompts: list[PromptItem]


class PromptUpdateRequest(BaseModel):
    template: str = Field(..., min_length=1)
