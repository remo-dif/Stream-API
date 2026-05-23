export enum LlmProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
}

export const SYSTEM_PROMPT =
  'You are a helpful AI assistant. Be concise, accurate, and professional.';

export const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  [LlmProvider.OPENAI]: 'gpt-4.1-mini',
  [LlmProvider.ANTHROPIC]: 'claude-3-5-sonnet-20241022',
};

export function inferProviderFromModel(model: string): LlmProvider | null {
  if (model.startsWith('claude-')) {
    return LlmProvider.ANTHROPIC;
  }

  if (model.startsWith('gpt-') || model.startsWith('o')) {
    return LlmProvider.OPENAI;
  }

  return null;
}
