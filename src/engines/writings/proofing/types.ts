export interface GrammarMatch {
  offset: number; length: number; message: string; shortMessage?: string;
  replacements: { value: string }[]; rule: { id: string; category?: { id: string; name: string }; issueType?: string };
}
export interface GrammarCheckResponse { ok: boolean; matches?: GrammarMatch[]; error?: string; code?: string }
export interface ProofingFinding {
  id: string; from: number; to: number; original: string; suggestions: string[];
  category: 'spelling' | 'grammar'; rule: string; message: string;
}
export interface SpellWordResult { word: string; correct: boolean; suggestions: string[] }
export interface SpellChecker { check(words: readonly string[], personalWords?: readonly string[]): Promise<SpellWordResult[]> }
