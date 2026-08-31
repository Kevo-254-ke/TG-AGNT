export interface SkillMetadata {
  id: string;
  title: string;
  description: string;
  tags: string[];
  languages?: string[];
  frameworks?: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface Skill {
  metadata: SkillMetadata;
  content: string;
  embedding?: number[] | null;
}

export interface SkillMatch {
  skill: Skill;
  score: number;
}
