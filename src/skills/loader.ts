import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../core/logger';
import type { Skill, SkillMetadata } from './types';

const log = logger.child({ module: 'skills:loader' });

// __dirname is dist/skills/ in production, src/skills/ in ts-node
// Go up two levels to project root, then into src/skills/data
const SKILLS_DIR = path.resolve(__dirname, '..', '..', 'src', 'skills', 'data');

interface ParsedSkill {
  metadata: SkillMetadata;
  content: string;
}

export async function loadSkills(): Promise<Skill[]> {
  const files = await fs.readdir(SKILLS_DIR);
  const mdFiles = files.filter((f) => f.endsWith('.md'));

  const skills: Skill[] = [];

  for (const filename of mdFiles) {
    try {
      const raw = await fs.readFile(path.join(SKILLS_DIR, filename), 'utf-8');
      const parsed = parseSkillFile(raw, filename);
      skills.push({
        metadata: parsed.metadata,
        content: parsed.content,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.warn({ filename, err: reason }, 'Failed to load skill file');
    }
  }

  log.info({ count: skills.length, dir: SKILLS_DIR }, 'Skills loaded');
  return skills;
}

function parseSkillFile(raw: string, filename: string): ParsedSkill {
  const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    throw new Error(`Invalid skill file format: ${filename}`);
  }

  const yaml = frontmatterMatch[1];
  const content = frontmatterMatch[2].trim();

  const metadata = parseYaml(yaml, filename);

  return { metadata, content };
}

function parseYaml(yaml: string, filename: string): SkillMetadata {
  const lines = yaml.split('\n');
  const meta: Record<string, unknown> = {};

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;

    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      meta[key] = value.trim();
    }
  }

  const id = meta.id as string;
  if (!id) throw new Error(`Skill ${filename} missing 'id'`);

  return {
    id,
    title: (meta.title as string) || id,
    description: (meta.description as string) || '',
    tags: (meta.tags as string[]) || [],
    languages: (meta.languages as string[]) || [],
    frameworks: (meta.frameworks as string[]) || [],
    priority: (meta.priority as SkillMetadata['priority']) || 'medium',
  };
}
