export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  content: string;
  device_name: string;
  created_at: string;
}

export type MessageStatus = "pending" | "confirmed" | "failed";

export interface LocalMessage extends Message {
  clientId?: string;
  status: MessageStatus;
}
