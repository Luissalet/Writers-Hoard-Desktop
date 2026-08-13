export interface Biography {
  id: string;
  projectId: string;
  subjectId?: string;        // Codex entry ID
  subjectName: string;
  subjectPhoto?: string;     // base64
  createdAt: number;
  updatedAt: number;
}

export type BiographyCategory =
  | 'birth' | 'death' | 'education' | 'career'
  | 'relationship' | 'achievement' | 'conflict'
  | 'travel' | 'health' | 'personal' | 'political'
  | 'creative' | 'custom';

export interface BiographyFact {
  id: string;
  biographyId: string;
  projectId: string;
  title: string;
  content: string;           // Rich text
  date?: string;
  endDate?: string;
  category: BiographyCategory;
  order: number;
  sources: FactSource[];
  confidence: 'confirmed' | 'likely' | 'uncertain' | 'disputed';
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface FactSource {
  type: 'snapshot' | 'link' | 'manual' | 'interview';
  entityId?: string;
  description: string;
  url?: string;
}

export const BIOGRAPHY_CATEGORIES: Record<BiographyCategory, { labelKey: string; color: string }> = {
  birth: { labelKey: 'biography.category.birth', color: 'from-emerald-500 to-green-600' },
  death: { labelKey: 'biography.category.death', color: 'from-slate-700 to-gray-800' },
  education: { labelKey: 'biography.category.education', color: 'from-blue-500 to-cyan-600' },
  career: { labelKey: 'biography.category.career', color: 'from-amber-500 to-orange-600' },
  relationship: { labelKey: 'biography.category.relationship', color: 'from-pink-500 to-rose-600' },
  achievement: { labelKey: 'biography.category.achievement', color: 'from-yellow-500 to-amber-600' },
  conflict: { labelKey: 'biography.category.conflict', color: 'from-red-500 to-rose-600' },
  travel: { labelKey: 'biography.category.travel', color: 'from-purple-500 to-indigo-600' },
  health: { labelKey: 'biography.category.health', color: 'from-red-400 to-pink-500' },
  personal: { labelKey: 'biography.category.personal', color: 'from-violet-500 to-purple-600' },
  political: { labelKey: 'biography.category.political', color: 'from-red-600 to-amber-600' },
  creative: { labelKey: 'biography.category.creative', color: 'from-cyan-500 to-blue-600' },
  custom: { labelKey: 'biography.category.custom', color: 'from-gray-400 to-gray-600' },
};

export const CONFIDENCE_LEVELS = {
  confirmed: { labelKey: 'biography.confidence.confirmed', icon: 'check', color: 'text-green-500' },
  likely: { labelKey: 'biography.confidence.likely', icon: 'questionmark', color: 'text-yellow-500' },
  uncertain: { labelKey: 'biography.confidence.uncertain', icon: 'tilde', color: 'text-gray-500' },
  disputed: { labelKey: 'biography.confidence.disputed', icon: 'exclamation', color: 'text-red-500' },
};
