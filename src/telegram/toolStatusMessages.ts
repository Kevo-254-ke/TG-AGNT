/**
 * Friendly present-tense phrasing for each tool, shown as a live status
 * message while the bot works — turns a silent multi-second wait into
 * visible progress instead of dead air. Falls back to a generic phrase
 * for any tool not explicitly listed, so adding a new tool to
 * toolRegistry.ts never breaks this.
 */
export function describeToolCall(name: string, args: Record<string, unknown>): string {
  const filename = typeof args.filename === 'string' ? args.filename : undefined;
  const dirname = typeof args.dirname === 'string' ? args.dirname : undefined;
  const outputName = typeof args.outputName === 'string' ? args.outputName : undefined;
  const language = typeof args.language === 'string' ? args.language : undefined;

  switch (name) {
    case 'create_file':
      return `📝 Writing ${filename ?? 'a file'}...`;
    case 'read_file':
      return `📖 Reading ${filename ?? 'the file'}...`;
    case 'read_document':
      return `📄 Parsing ${filename ?? 'the document'}...`;
    case 'update_file':
      return `✏️ Updating ${filename ?? 'the file'}...`;
    case 'delete_file':
      return `🗑️ Deleting ${filename ?? 'the file'}...`;
    case 'list_files':
      return `📁 Looking through ${dirname && dirname !== '.' ? dirname : 'the workspace'}...`;
    case 'zip_files':
      return `📦 Zipping ${outputName ?? 'files'}...`;
    case 'unzip_file':
      return `📂 Unzipping ${filename ?? 'the archive'}...`;
    case 'execute_code':
      return `⚙️ Running ${language ?? 'the'} snippet...`;
    default:
      return `🔧 Running ${name}...`;
  }
}

/** Rotates the opening "thinking" message so back-to-back turns don't look identical. */
const THINKING_PHRASES = ['🤔 Thinking...', '🧠 Working on it...', '🔍 Looking into it...'];

export function randomThinkingPhrase(): string {
  return THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
}
