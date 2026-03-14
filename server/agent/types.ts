// Minimal JSON Schema type for tool parameter definitions
export interface JSONSchema7 {
  type?: string;
  properties?: Record<string, JSONSchema7>;
  required?: string[];
  description?: string;
  enum?: unknown[];
  items?: JSONSchema7;
  default?: unknown;
  additionalProperties?: boolean | JSONSchema7;
}

// Agent loop event types emitted via SSE
export type AgentEvent =
  | { type: 'agent_status'; iteration: number; maxIterations: number }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; id: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; tool: string; output: string; error?: string; artifacts?: unknown[]; usage?: { model: string; promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'text_delta'; text: string }
  | { type: 'cc_text'; text: string }
  | { type: 'done'; content: string; iterations: number; toolCalls: ToolCallRecord[]; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; toolUsage?: Array<{ model: string; promptTokens: number; completionTokens: number; totalTokens: number }> }
  | { type: 'error'; message: string };

export interface ToolCallRecord {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  output: string;
  error?: string;
  durationMs: number;
}

export interface AgentConfig {
  model: string;
  maxIterations: number;
  userId: string;
  conversationId?: string;
  temperature?: number;
  maxTokens?: number;
  thinkingEnabled?: boolean;
  thinkingBudget?: number;
  thorMode?: boolean;
}
