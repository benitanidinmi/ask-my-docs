export type StoredChunk = {
  text: string;
  embedding: number[];
};

export type DocumentKind = "txt" | "pdf" | "image";

export type SourceEvidence = {
  id: string;
  excerpt: string;
  label: string;
  page?: number;
};

export type UploadResult = {
  ok: boolean;
  code?: string;
  retryAfter?: number;
  filename?: string;
  documentText?: string;
  documentKind?: DocumentKind;
  message?: string;
};

export type AskResult = {
  ok: boolean;
  code?: string;
  retryAfter?: number;
  answer?: string;
  sources?: SourceEvidence[];
  message?: string;
};
