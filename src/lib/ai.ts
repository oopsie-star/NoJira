export type LLMProvider = 'openrouter' | 'gemini' | 'deepseek' | 'openai' | 'custom'

export interface LLMConfig {
  provider: LLMProvider
  model: string
  apiKey: string
  customEndpoint?: string
}

export interface LLMToolCall {
  id: string
  name: string
  /** Raw JSON string of arguments, as returned by the model — caller parses it. */
  arguments: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Present on an assistant message that requested tool calls. */
  toolCalls?: LLMToolCall[]
  /** Present on a 'tool' message — which call this is the result of. */
  toolCallId?: string
}

export interface LLMToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface LLMResult {
  content: string | null
  error: string | null
  toolCalls?: LLMToolCall[]
  /** 'length' means the response was cut off by the max-tokens limit — a likely cause of truncated/invalid tool-call JSON. */
  finishReason?: string
}

export interface LLMModelOption {
  id: string
  label: string
  description?: string
  contextWindow?: string
  providerLabel?: string
}

interface ModelListOptions {
  apiKey?: string
  customEndpoint?: string
}

const STORAGE_KEY = 'qira_llm_config'

const FALLBACK_MODEL_LIBRARY: Record<LLMProvider, LLMModelOption[]> = {
  openrouter: [
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', providerLabel: 'Google', description: 'Fast multimodal general-purpose model.' },
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', providerLabel: 'Google', description: 'High-quality reasoning and coding model.' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', providerLabel: 'OpenAI', description: 'Cheap and fast general-purpose model.' },
    { id: 'openai/gpt-4.1', label: 'GPT-4.1', providerLabel: 'OpenAI', description: 'Balanced coding and instruction-following model.' },
    { id: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet', providerLabel: 'Anthropic', description: 'Strong coding and reasoning model.' },
    { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', providerLabel: 'DeepSeek', description: 'Reasoning-focused model via OpenRouter.' },
    { id: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3', providerLabel: 'DeepSeek', description: 'Fast chat model via OpenRouter.' },
    { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct', providerLabel: 'Meta', description: 'Large open model with strong instruction tuning.' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast Gemini model for chat, coding, and multimodal tasks.' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Best Gemini reasoning and code quality.' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', description: 'Lowest-latency Gemini 2.5 variant.' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Stable low-latency Gemini model.' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite', description: 'Lightweight Gemini 2.0 variant.' },
  ],
  deepseek: [
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', description: 'Current fast DeepSeek model.' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', description: 'Current top-tier DeepSeek model.' },
    { id: 'deepseek-chat', label: 'DeepSeek Chat', description: 'Legacy compatibility alias for the non-thinking mode.' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', description: 'Legacy compatibility alias for the reasoning mode.' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Small, fast, low-cost OpenAI model.' },
    { id: 'gpt-4o', label: 'GPT-4o', description: 'Omnimodal flagship model for broad use.' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', description: 'Balanced latency/cost for chat and code.' },
    { id: 'gpt-4.1', label: 'GPT-4.1', description: 'Higher-quality text and coding model.' },
    { id: 'o4-mini', label: 'o4-mini', description: 'Fast reasoning-oriented model.' },
    { id: 'o3', label: 'o3', description: 'Higher-end reasoning model.' },
  ],
  custom: [
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini', description: 'Common OpenAI-compatible default model.' },
    { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', description: 'Common OpenAI-compatible DeepSeek model.' },
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash', description: 'Common OpenAI-compatible Gemini model.' },
  ],
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openrouter: FALLBACK_MODEL_LIBRARY.openrouter[0].id,
  gemini: FALLBACK_MODEL_LIBRARY.gemini[0].id,
  deepseek: FALLBACK_MODEL_LIBRARY.deepseek[0].id,
  openai: FALLBACK_MODEL_LIBRARY.openai[0].id,
  custom: FALLBACK_MODEL_LIBRARY.custom[0].id,
}

const PROVIDER_ENDPOINTS: Record<LLMProvider, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  custom: 'https://api.openai.com/v1/chat/completions',
}

function normalizeModelId(provider: LLMProvider, model: string | null | undefined) {
  const candidate = model?.trim()
  if (!candidate) return DEFAULT_MODELS[provider]

  const providerModels = FALLBACK_MODEL_LIBRARY[provider]
  const match = providerModels.find((option) => (
    option.id.toLowerCase() === candidate.toLowerCase()
    || option.label.toLowerCase() === candidate.toLowerCase()
  ))

  return match?.id ?? candidate
}

function mergeModelOptions(primary: LLMModelOption[], fallback: LLMModelOption[]) {
  const merged = new Map<string, LLMModelOption>()

  for (const option of fallback) {
    merged.set(option.id, option)
  }

  for (const option of primary) {
    const existing = merged.get(option.id)
    merged.set(option.id, {
      ...existing,
      ...option,
      description: option.description || existing?.description,
      contextWindow: option.contextWindow || existing?.contextWindow,
      providerLabel: option.providerLabel || existing?.providerLabel,
    })
  }

  return Array.from(merged.values())
}

function formatContextWindow(contextLength?: number | null) {
  if (!contextLength || Number.isNaN(contextLength)) return undefined
  if (contextLength >= 1_000_000) return `${Math.round(contextLength / 100_000) / 10}M ctx`
  if (contextLength >= 1_000) return `${Math.round(contextLength / 100) / 10}K ctx`
  return `${contextLength} ctx`
}

function isTextGenerationModel(id: string) {
  const value = id.toLowerCase()
  return /(^gpt|^o\d|^chatgpt|^deepseek|^gemini|^claude|^qwen|^mistral|^llama|^meta-|^x-ai|^grok|^codestral|^ministral|^command)/.test(value)
}

async function readErrorResponse(response: Response) {
  const text = await response.text()
  return text || response.statusText
}

async function fetchOpenAICompatibleModels(endpoint: string, apiKey: string) {
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await readErrorResponse(response)}`)
  }

  const json = await response.json() as {
    data?: Array<{
      id?: string
      name?: string
      description?: string
      owned_by?: string
      context_length?: number
    }>
  }

  return (json.data ?? [])
    .filter((model): model is NonNullable<typeof model> & { id: string } => Boolean(model.id))
    .filter((model) => isTextGenerationModel(model.id))
    .map((model) => ({
      id: model.id,
      label: model.name || model.id,
      description: model.description,
      contextWindow: formatContextWindow(model.context_length),
      providerLabel: model.owned_by,
    }))
}

async function fetchOpenRouterModels() {
  const response = await fetch('https://openrouter.ai/api/v1/models')
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await readErrorResponse(response)}`)
  }

  const json = await response.json() as {
    data?: Array<{
      id?: string
      name?: string
      description?: string
      context_length?: number
      top_provider?: { name?: string }
    }>
  }

  return (json.data ?? [])
    .filter((model): model is NonNullable<typeof model> & { id: string } => Boolean(model.id))
    .filter((model) => isTextGenerationModel(model.id))
    .map((model) => ({
      id: model.id,
      label: model.name || model.id,
      description: model.description,
      contextWindow: formatContextWindow(model.context_length),
      providerLabel: model.top_provider?.name,
    }))
}

async function fetchGeminiModels(apiKey: string) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await readErrorResponse(response)}`)
  }

  const json = await response.json() as {
    models?: Array<{
      name?: string
      displayName?: string
      description?: string
      inputTokenLimit?: number
      supportedGenerationMethods?: string[]
    }>
  }

  return (json.models ?? [])
    .filter((model) => model.name?.startsWith('models/gemini'))
    .filter((model) => (model.supportedGenerationMethods ?? []).some((method) => method.toLowerCase().includes('generate')))
    .map((model) => ({
      id: (model.name ?? '').replace(/^models\//, ''),
      label: model.displayName || (model.name ?? '').replace(/^models\//, ''),
      description: model.description,
      contextWindow: formatContextWindow(model.inputTokenLimit),
    }))
}

function buildCustomModelsEndpoint(customEndpoint?: string) {
  if (!customEndpoint) return null

  try {
    const url = new URL(customEndpoint)

    if (url.pathname.endsWith('/chat/completions')) {
      url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models')
      return url.toString()
    }

    if (url.pathname.endsWith('/responses')) {
      url.pathname = url.pathname.replace(/\/responses$/, '/models')
      return url.toString()
    }

    if (url.pathname.endsWith('/models')) {
      return url.toString()
    }

    if (url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}models`
      return url.toString()
    }

    url.pathname = `${url.pathname}/models`
    return url.toString()
  } catch {
    return null
  }
}

export function getFallbackModelOptions(provider: LLMProvider) {
  return FALLBACK_MODEL_LIBRARY[provider].slice()
}

export async function listLLMModels(provider: LLMProvider, options: ModelListOptions = {}) {
  const fallback = getFallbackModelOptions(provider)

  try {
    if (provider === 'openrouter') {
      return mergeModelOptions(await fetchOpenRouterModels(), fallback)
    }

    if (provider === 'gemini') {
      if (!options.apiKey) return fallback
      return mergeModelOptions(await fetchGeminiModels(options.apiKey), fallback)
    }

    if (provider === 'openai') {
      if (!options.apiKey) return fallback
      return mergeModelOptions(await fetchOpenAICompatibleModels('https://api.openai.com/v1/models', options.apiKey), fallback)
    }

    if (provider === 'deepseek') {
      if (!options.apiKey) return fallback
      return mergeModelOptions(await fetchOpenAICompatibleModels('https://api.deepseek.com/models', options.apiKey), fallback)
    }

    const modelsEndpoint = buildCustomModelsEndpoint(options.customEndpoint)
    if (!options.apiKey || !modelsEndpoint) return fallback
    return mergeModelOptions(await fetchOpenAICompatibleModels(modelsEndpoint, options.apiKey), fallback)
  } catch {
    return fallback
  }
}

export function getLLMConfig(): LLMConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LLMConfig>
      if (parsed.provider && parsed.apiKey !== undefined) {
        return {
          provider: parsed.provider,
          model: normalizeModelId(parsed.provider, parsed.model),
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    ...config,
    model: normalizeModelId(config.provider, config.model),
  }))
}

function toWireMessage(message: LLMMessage) {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }

  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    }
  }

  return { role: message.role, content: message.content }
}

export async function callLLM(
  messages: LLMMessage[],
  opts?: { maxTokens?: number; tools?: LLMToolDefinition[]; toolChoice?: 'auto' | { name: string } },
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
        model: normalizeModelId(config.provider, config.model),
        messages: messages.map(toWireMessage),
        max_tokens: opts?.maxTokens ?? 1024,
        ...(opts?.tools?.length ? {
          tools: opts.tools.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
          tool_choice: typeof opts.toolChoice === 'object'
            ? { type: 'function', function: { name: opts.toolChoice.name } }
            : (opts.toolChoice ?? 'auto'),
        } : {}),
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      return { content: null, error: `HTTP ${response.status}: ${text}` }
    }

    const json = await response.json() as {
      choices?: Array<{
        finish_reason?: string
        message?: {
          content?: string
          tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>
        }
      }>
      error?: { message?: string }
    }

    if (json.error?.message) {
      return { content: null, error: json.error.message }
    }

    const choice = json.choices?.[0]
    const message = choice?.message
    const content = message?.content ?? null
    const toolCalls = message?.tool_calls
      ?.filter((call) => call.function?.name)
      .map((call) => ({
        id: call.id,
        name: call.function!.name!,
        arguments: call.function!.arguments ?? '{}',
      }))

    return { content, error: null, toolCalls: toolCalls?.length ? toolCalls : undefined, finishReason: choice?.finish_reason }
  } catch (err) {
    return { content: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export { DEFAULT_MODELS }
