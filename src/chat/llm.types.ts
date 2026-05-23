export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type CompletionResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

export type StreamFinalResponse = {
  inputTokens: number;
  outputTokens: number;
  model: string;
};

export type StreamTextDelta = {
  text: string;
};

export interface AITextStream extends AsyncIterable<StreamTextDelta> {
  ended: boolean;
  abort(): void;
  finalResponse(): Promise<StreamFinalResponse>;
}
