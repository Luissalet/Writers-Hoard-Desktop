export interface VideoPlan {
  id: string;
  projectId: string;
  title: string;
  totalDuration?: string;
  createdAt: number;
  updatedAt: number;
}

export type VisualType = 'camera' | 'broll' | 'screen-capture' | 'graphic' | 'text-overlay' | 'custom';

export interface VideoSegment {
  id: string;
  videoPlanId: string;
  projectId: string;
  order: number;
  title: string;
  startTime?: string;
  endTime?: string;
  script: string;
  speakerId?: string;
  speakerName?: string;
  visualType: VisualType;
  visualDescription?: string;
  visualImageData?: string; // base64 (cropped for display)
  visualImageDataOriginal?: string; // base64 — original uncropped source
  audioNotes?: string;
  notes?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
