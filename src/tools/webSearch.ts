import { logger } from '../core/logger';

const log = logger.child({ module: 'tools:webSearch' });

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebPageContent {
  url: string;
  title: string;
  content: string;
  error?: string;
}

const MAX_SEARCH_RESULTS = 5;
const MAX_CONTENT_CHARS = 8000;
const FETCH_TIMEOUT_MS = 10_000;

export async function webSearch(query: string): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`DuckDuckGo returned ${response.status}`);
    }

    const html = await response.text();
    return parseDuckDuckGoResults(html).slice(0, MAX_SEARCH_RESULTS);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn({ query, err: reason }, 'Web search failed');
    return [];
  }
}

export async function fetchWebpage(url: string): Promise<WebPageContent> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const title = extractTitle(html);
    const text = htmlToText(html);

    return {
      url,
      title,
      content: text.slice(0, MAX_CONTENT_CHARS),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.warn({ url, err: reason }, 'Failed to fetch webpage');
    return { url, title: '', content: '', error: reason };
  }
}

function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const resultBlocks = html.match(/<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="result|<div class="no-results)/g);

  if (!resultBlocks) return results;

  for (const block of resultBlocks) {
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/);
    const urlMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"/);
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/);

    if (titleMatch && urlMatch) {
      results.push({
        title: stripHtml(titleMatch[1]),
        url: decodeHtmlEntities(urlMatch[1]),
        snippet: snippetMatch ? stripHtml(snippetMatch[1]) : '',
      });
    }
  }

  return results;
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return match ? stripHtml(match[1]) : '';
}

function htmlToText(html: string): string {
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|pre|blockquote)>/gi, '\n');
  text = text.replace(/<(br\s*\/?|hr\s*\/?)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = decodeHtmlEntities(text);
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  text = text.replace(/[ \t]+/g, ' ');
  return text;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&nbsp;': ' ',
    '&ndash;': '–',
    '&mdash;': '—',
    '&hellip;': '…',
  };

  for (const [entity, char] of Object.entries(entities)) {
    text = text.replace(new RegExp(entity, 'g'), char);
  }

  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  return text;
}
