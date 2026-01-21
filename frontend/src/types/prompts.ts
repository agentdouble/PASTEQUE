export interface PromptItem {
  key: string
  label: string
  description?: string | null
  template: string
  placeholders: string[]
  allowed_variables: string[]
}

export interface PromptsResponse {
  version: number
  prompts: PromptItem[]
}
