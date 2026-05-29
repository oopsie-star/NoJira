export type LLMProvider = 'openrouter' | 'gemini' | 'deepseek' | 'openai' | 'custom'

export interface LLMConfig {
  provider: LLMProvider
  model: string
  apiKey: string
  customEndpoint?: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMResult {
  content: string | null
  error: string | null
}

const STORAGE_KEY = 'qira_llm_config'

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openrouter: 'google/gemini-2.5-flash',
  gemini: 'gemini-2.0-flash',
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
  custom: 'gpt-4o-mini',
}

const PROVIDER_ENDPOINTS: Record<LLMProvider, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  custom: 'https://api.openai.com/v1/chat/completions',
}

export function getLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LLMConfig>
      if (parsed.provider && parsed.apiKey !== undefined) {
        return {
          provider: parsed.provider,
          model: parsed.model ?? DEFAULT_MODELS[parsed.provider],
          apiKey: parsed.apiKey,
          customEndpoint: parsed.customEndpoint,
        }
      }
    }
  } catch {
    // ignore parse errors
  }
  return { provider: 'openrouter', model: DEFAULT_MODELS.openrouter, apiKey: '' }
}

export function setLLMConfig(config: LLMConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export async function callLLM(
  messages: LLMMessage[],
  opts?: { maxTokens?: number },
): Promise<LLMResult> {
  const config = getLLMConfig()

  if (!config.apiKey) {
    return { content: null, error: 'No API key configured' }
  }

  let endpoint = PROVIDER_ENDPOINTS[config.provider]
  if (config.provider === 'custom' && config.customEndpoint) {
    endpoint = config.customEndpoint
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  }

  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://oopsie-star.github.io/NoJira/'
    headers['X-Title'] = 'Qira'
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        max_tokens: opts?.maxTokens ?? 1024,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return { content: null, error: `HTTP ${response.status}: ${text}` }
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }

    if (json.error?.message) {
      return { content: null, error: json.error.message }
    }

    const content = json.choices?.[0]?.message?.content ?? null
    return { content, error: null }
  } catch (err) {
    return { content: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export { DEFAULT_MODELS }
