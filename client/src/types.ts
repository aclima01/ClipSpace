export interface Notebook {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  notebook_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface NotebookWithPages extends Notebook {
  pages: Page[];
}

export interface Message {
  id: string;
  page_id: string;
  content: string;
  device_name: string;
  created_at: string;
  pinned: boolean;
}

export type MessageStatus = "pending" | "confirmed" | "failed";

export interface LocalMessage extends Message {
  clientId?: string;
  status: MessageStatus;
}
