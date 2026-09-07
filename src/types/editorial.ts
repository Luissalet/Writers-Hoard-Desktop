/** A writer-approved project brief. Examples are source material, never instructions. */
export interface EditorialProfile {
  enabled: boolean;
  voice: string;
  audience: string;
  rules: string;
  context: string;
  examples: string;
  revision: number;
}
