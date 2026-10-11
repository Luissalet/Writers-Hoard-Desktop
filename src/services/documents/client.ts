import { NATIVE_DOCUMENT_ACTIONS } from '@/services/aiBridge/manifestDocuments';

export interface DocumentReply<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
  code?: string;
}

export interface DocumentsApi {
  call(request: { tool: string; args: Record<string, unknown> }): Promise<DocumentReply>;
}

/** The desktop bridge, shared by document controls and renderer tool handlers. */
export async function callDocumentTool<T = unknown>(tool: string, args: Record<string, unknown> = {}): Promise<DocumentReply<T>> {
  const api = (window.electronAPI as (typeof window.electronAPI & { documents?: DocumentsApi }) | undefined)?.documents;
  if (!api) return { ok: false, code: 'desktop-required', error: 'El núcleo documental necesita la aplicación de escritorio de Writers.' };
  return await api.call({ tool, args }) as DocumentReply<T>;
}

export async function requestDocument<T = unknown>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const tool = Object.entries(NATIVE_DOCUMENT_ACTIONS).find(([, id]) => id === action)?.[0];
  if (!tool) throw new Error(`Unknown document action: ${action}`);
  const reply = await callDocumentTool<T>(tool, args);
  if (!reply.ok) throw new Error(reply.error || reply.code || 'Document operation failed');
  return reply.result as T;
}

export function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  const result = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) result[i] = decoded.charCodeAt(i);
  return result;
}

export function base64FromBytes(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
