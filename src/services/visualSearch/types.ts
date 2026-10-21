export interface VisualSearchStatus {
  state: 'missing' | 'preparing' | 'ready' | 'error';
  model: string;
  detail?: string;
  progress?: number;
}
export interface VisualEmbedding { hash: string; model: string; vector: number[]; cached: boolean }
export interface VisualSearchAPI {
  status(): Promise<VisualSearchStatus>;
  prepare(): Promise<VisualSearchStatus>;
  image(dataUrl: string): Promise<VisualEmbedding>;
  text(query: string): Promise<number[]>;
}
