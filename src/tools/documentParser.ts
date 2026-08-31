import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { logger } from '../core/logger';

const log = logger.child({ module: 'tools:documentParser' });

export type DocumentType = 'pdf' | 'docx' | 'csv' | 'txt' | 'json' | 'md' | 'unknown';

export interface ParsedDocument {
  type: DocumentType;
  filename: string;
  content: string;
  rows?: number;
  pages?: number;
  error?: string;
}

const MAX_DOCUMENT_CHARS = 50_000;

export function detectDocumentType(filename: string): DocumentType {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'pdf';
    case '.docx':
      return 'docx';
    case '.csv':
      return 'csv';
    case '.txt':
      return 'txt';
    case '.json':
      return 'json';
    case '.md':
    case '.markdown':
      return 'md';
    default:
      return 'unknown';
  }
}

export async function parseDocument(absolutePath: string, filename: string): Promise<ParsedDocument> {
  const type = detectDocumentType(filename);

  try {
    switch (type) {
      case 'txt':
      case 'md':
        return await parseTextFile(absolutePath, filename, type);
      case 'json':
        return await parseJsonFile(absolutePath, filename);
      case 'csv':
        return await parseCsvFile(absolutePath, filename);
      case 'docx':
        return await parseDocxFile(absolutePath, filename);
      case 'pdf':
        return await parsePdfFile(absolutePath, filename);
      default:
        return {
          type: 'unknown',
          filename,
          content: '',
          error: `Unsupported file type: ${path.extname(filename)}. Supported: .txt, .md, .json, .csv, .docx, .pdf`,
        };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn({ filename, type, err: reason }, 'Document parsing failed');
    return { type, filename, content: '', error: reason };
  }
}

async function parseTextFile(absolutePath: string, filename: string, type: DocumentType): Promise<ParsedDocument> {
  const raw = await fs.readFile(absolutePath, 'utf-8');
  return {
    type,
    filename,
    content: truncate(raw),
  };
}

async function parseJsonFile(absolutePath: string, filename: string): Promise<ParsedDocument> {
  const raw = await fs.readFile(absolutePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: 'json', filename, content: truncate(raw), error: 'Invalid JSON — returning raw text' };
  }
  const pretty = JSON.stringify(parsed, null, 2);
  return { type: 'json', filename, content: truncate(pretty) };
}

async function parseCsvFile(absolutePath: string, filename: string): Promise<ParsedDocument> {
  const raw = await fs.readFile(absolutePath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { type: 'csv', filename, content: '(empty CSV)', rows: 0 };
  }

  const header = lines[0];
  const rows = lines.slice(1);
  const previewRows = rows.slice(0, 50);

  let content = `CSV: ${filename}\nHeader: ${header}\nRows: ${rows.length}\n\nPreview (first ${previewRows.length} rows):\n`;
  content += previewRows.join('\n');

  if (rows.length > previewRows.length) {
    content += `\n\n... (${rows.length - previewRows.length} more rows truncated)`;
  }

  return { type: 'csv', filename, content: truncate(content), rows: rows.length };
}

async function parseDocxFile(absolutePath: string, filename: string): Promise<ParsedDocument> {
  try {
    const zip = new AdmZip(absolutePath);
    const documentXmlEntry = zip.getEntry('word/document.xml');
    if (!documentXmlEntry) {
      return { type: 'docx', filename, content: '', error: 'Could not find word/document.xml inside the DOCX archive' };
    }

    const xml = documentXmlEntry.getData().toString('utf-8');
    const text = stripXmlTags(xml);
    return { type: 'docx', filename, content: truncate(text) };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { type: 'docx', filename, content: '', error: `DOCX parse error: ${reason}` };
  }
}

async function parsePdfFile(absolutePath: string, filename: string): Promise<ParsedDocument> {
  try {
    const buffer = await fs.readFile(absolutePath);
    const text = extractPdfText(buffer);
    const pages = countPdfPages(buffer);
    return { type: 'pdf', filename, content: truncate(text), pages };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { type: 'pdf', filename, content: '', error: `PDF parse error: ${reason}` };
  }
}

function stripXmlTags(xml: string): string {
  let text = xml.replace(/<\/w:p>/g, '\n\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x?([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

function extractPdfText(buffer: Buffer): string {
  const pdf = buffer.toString('binary');
  const lines: string[] = [];

  const textMatches = pdf.match(/\(([^)]*)\)\s*Tj/g);
  if (textMatches) {
    for (const match of textMatches) {
      const text = match.replace(/^\(/, '').replace(/\)\s*Tj$/, '');
      const unescaped = text
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\b/g, '\b')
        .replace(/\\f/g, '\f')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (unescaped.trim()) lines.push(unescaped);
    }
  }

  const hexMatches = pdf.match(/<([0-9a-fA-F]+)>\s*Tj/g);
  if (hexMatches) {
    for (const match of hexMatches) {
      const hex = match.replace(/^</, '').replace(/>\s*Tj$/, '');
      let text = '';
      for (let i = 0; i < hex.length; i += 2) {
        text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      if (text.trim()) lines.push(text);
    }
  }

  return lines.join('\n').trim();
}

function countPdfPages(buffer: Buffer): number {
  const pdf = buffer.toString('binary');
  const matches = pdf.match(/\/Type\s*\/Page(?:[^s]|$)/g);
  return matches ? matches.length : 0;
}

function truncate(text: string): string {
  if (text.length <= MAX_DOCUMENT_CHARS) return text;
  return text.slice(0, MAX_DOCUMENT_CHARS) + `\n\n[... truncated: ${text.length - MAX_DOCUMENT_CHARS} more characters]`;
}
