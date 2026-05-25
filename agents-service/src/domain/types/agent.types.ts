/**
 * Domain types for the agent capability.
 *
 * These are the payload types that go inside CapabilityRequest<T> / CapabilityResponse<T>.
 * They are kept independent of any specific LLM provider API shapes.
 */

// -------------------------------------------------------------------------------------------------
// Task type — drives provider selection via TaskTypePriorityPolicy
// -------------------------------------------------------------------------------------------------

export type TaskType = "reasoning" | "coding" | "vision" | "audio" | "general";

export type ResponseMode = "fast" | "reasoning";

// -------------------------------------------------------------------------------------------------
// Chat
// -------------------------------------------------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequestPayload {
  message: ChatMessage;
  user_id?: string;
  conversation_id?: string;
  wallet_address?: string;
  chain_id?: number;
  response_mode?: ResponseMode;
  task_type?: TaskType;
  metadata?: Record<string, unknown>;
}

export interface AgentAction {
  type: string;
  label: string;
  payload?: unknown;
}

export interface ChatResponseData {
  message: string;
  requires_action: boolean;
  actions?: AgentAction[];
  agent_name?: string | null;
  agent_type?: string | null;
  conversation_id?: string;
  metadata?: Record<string, unknown> | null;
}

// -------------------------------------------------------------------------------------------------
// Streaming
// -------------------------------------------------------------------------------------------------

export interface ChatChunk {
  type: "metadata" | "delta" | "done" | "error";
  delta?: string;
  conversation_id?: string;
  agent_name?: string | null;
  agent_type?: string | null;
  metadata?: Record<string, unknown>;
}

// -------------------------------------------------------------------------------------------------
// Transcription
// -------------------------------------------------------------------------------------------------

export interface TranscriptionRequestPayload {
  /** Raw audio blob — adapters receive this as a Buffer. */
  audio: Buffer;
  filename: string;
  mimeType: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationSeconds?: number;
}

// -------------------------------------------------------------------------------------------------
// Files (chat-with-files variant)
// -------------------------------------------------------------------------------------------------

export interface AttachedFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface ChatWithFilesRequestPayload extends ChatRequestPayload {
  files: AttachedFile[];
}

// -------------------------------------------------------------------------------------------------
// Conversation management
// -------------------------------------------------------------------------------------------------

export interface Conversation {
  id: string;
  user_id: string;
  title?: string;
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agent_name?: string | null;
  agent_type?: string | null;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
}
