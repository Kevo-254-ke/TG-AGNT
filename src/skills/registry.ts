import { logger } from '../core/logger';
import type { EmbeddingProvider } from '../core/types';
import type { Skill, SkillMatch } from './types';
import { loadSkills } from './loader';
import { cosineSimilarity } from '../memory/vectorSearch';

const log = logger.child({ module: 'skills:registry' });

const MAX_SKILL_CHARS = 4000;
const MAX_SKILLS_PER_QUERY = 4;

export class SkillRegistry {
  private skills: Skill[] = [];
  private ready = false;

  constructor(private readonly embeddings: EmbeddingProvider) {}

  async initialize(): Promise<void> {
    if (this.ready) return;
    this.skills = await loadSkills();

    for (const skill of this.skills) {
      const text = `${skill.metadata.title}. ${skill.metadata.description}. ${skill.metadata.tags.join(', ')}`;
      skill.embedding = await this.embeddings.embed(text);
    }

    this.ready = true;
    log.info({ count: this.skills.length }, 'Skill registry initialized');
  }

  async findRelevant(query: string): Promise<Skill[]> {
    if (!this.ready) await this.initialize();
    if (this.skills.length === 0) return [];

    const queryEmbedding = await this.embeddings.embed(query);
    if (!queryEmbedding) {
      return this.keywordMatch(query);
    }

    const scored: SkillMatch[] = this.skills
      .map((skill) => ({
        skill,
        score: skill.embedding ? cosineSimilarity(queryEmbedding, skill.embedding) : 0,
      }))
      .filter((m) => m.score > 0.3)
      .sort((a, b) => b.score - a.score);

    const prioritized = scored.sort((a, b) => {
      const priorityOrder = { critical: 3, high: 2, medium: 1, low: 0 };
      const priorityDiff = priorityOrder[b.skill.metadata.priority] - priorityOrder[a.skill.metadata.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.score - a.score;
    });

    const result: Skill[] = [];
    let charCount = 0;

    for (const match of prioritized.slice(0, MAX_SKILLS_PER_QUERY * 2)) {
      const skillText = this.formatSkill(match.skill);
      if (charCount + skillText.length > MAX_SKILL_CHARS && result.length >= 2) break;
      result.push(match.skill);
      charCount += skillText.length;
    }

    log.debug({ query: query.slice(0, 50), matched: result.map((s) => s.metadata.id) }, 'Skills matched');
    return result;
  }

  formatSkill(skill: Skill): string {
    return `## ${skill.metadata.title}\n${skill.content}`;
  }

  formatSkills(skills: Skill[]): string {
    if (skills.length === 0) return '';
    const header = '--- SKILLS & BEST PRACTICES ---\n';
    const body = skills.map((s) => this.formatSkill(s)).join('\n\n');
    return header + body + '\n--- END SKILLS ---\n';
  }

  private keywordMatch(query: string): Skill[] {
    const lower = query.toLowerCase();
    const words = lower.split(/\s+/);

    const scored = this.skills.map((skill) => {
      let score = 0;
      const skillText = `${skill.metadata.title} ${skill.metadata.description} ${skill.metadata.tags.join(' ')}`.toLowerCase();
      for (const word of words) {
        if (word.length < 3) continue;
        if (skillText.includes(word)) score += 1;
      }
      return { skill, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SKILLS_PER_QUERY)
      .map((s) => s.skill);
  }
}
