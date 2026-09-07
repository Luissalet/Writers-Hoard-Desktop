export type WritingWorkflowKind = 'reportage' | 'essay' | 'narrative';
export interface WorkflowMaterial { kind: 'note' | 'writing' | 'snapshot' | 'citation'; id: string }
export interface WorkflowStep { id: string; title: string; instructions: string; skipped: boolean; completed: boolean; output: string }
export interface WorkflowRevision { id: string; createdAt: number; steps: WorkflowStep[]; reason: 'save' | 'ai' | 'restore' }
export interface WritingWorkflow {
  id: string;
  title: string;
  kind: WritingWorkflowKind;
  revision: number;
  materials: WorkflowMaterial[];
  steps: WorkflowStep[];
  history: WorkflowRevision[];
  /** Each exported revision has its own immutable identity; re-clicks cannot duplicate it. */
  exports: { stepId: string; output: string; writingId: string }[];
  createdAt: number;
  updatedAt: number;
}
