export interface DocumentRecord {
  id: string;
  filename: string;
  kind: string;
  size: number;
  page_count: number;
  completed_pages: number;
  failed_pages: number;
  status: "queued" | "processing" | "completed" | "failed";
  language: string;
  handwriting: boolean;
  force_ocr: boolean;
  created_at: string;
  error: string | null;
}

export interface PageRecord {
  page_number: number;
  status: "pending" | "processing" | "completed" | "failed";
  raw_text: string;
  text: string;
  is_edited: boolean;
  revision: number;
  method: string | null;
  backend: string | null;
  confidence: number | null;
  error: string | null;
  updated_at: string | null;
}

export interface DocumentDetail extends DocumentRecord {
  pages: PageRecord[];
}
export interface SystemInfo {
  languages: { id: string; label: string }[];
  devices: { id: string; label: string }[];
  runtime: { state: string; backend: string | null; message?: string | null };
  limits: { file_mb: number; pages: number };
}

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.detail === "string"
        ? body.detail
        : `Request failed (${response.status}).`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export type ExportFormat = "xlsx" | "csv";

export function exportUrl(ids: string[] = [], format: ExportFormat = "csv") {
  const query = new URLSearchParams({ format });
  ids.forEach((id) => query.append("ids", id));
  return `/api/export?${query}`;
}

export function fileSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
