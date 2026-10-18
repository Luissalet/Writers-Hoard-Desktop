/** The host contributes domain context; Faustus owns the conversation. */
export interface WriterHoardContext {
  contract_version: '1.0';
  origin: { app_id: 'writer' | 'scheherazade'; data_space_id: string; surface: 'editor'; tool_server_id?: string };
  project: { external_project_id: string; title: string; description?: string };
  active_objects: Array<{ app_id: 'writer' | 'scheherazade'; data_space_id: string; kind: string; object_id: string; title?: string; revision?: string }>;
  selection?: { object_id: string; kind: 'text_range' | 'text'; text: string; revision?: string; range?: { start: number; end: number; unit: 'prosemirror' } };
  view: { mode: string; locale: string; enabled_engines: string[] };
  attachments: unknown[];
}

export interface FaustusHostInfo { server: string; embed_url: string; data_space_id: string; tool_server_id?: string }
export interface FaustusFetchRequest { id: string; url: string; method: string; headers: Array<[string, string]>; body?: ArrayBuffer }
export interface FaustusFetchResponse { status: number; statusText: string; headers: Array<[string, string]> }
export type FaustusFetchEvent = { id: string; type: 'chunk'; chunk: Uint8Array } | { id: string; type: 'end' } | { id: string; type: 'error'; message: string };
export interface FaustusHostBridge {
  getInfo(): Promise<FaustusHostInfo>;
  request(request: FaustusFetchRequest): Promise<FaustusFetchResponse>;
  cancel(id: string): Promise<void>;
  onEvent(listener: (event: FaustusFetchEvent) => void): () => void;
}
