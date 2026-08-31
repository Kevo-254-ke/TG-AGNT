import type { ToolDefinition } from '../core/types';

/**
 * OpenAI-style function-calling schemas. Kept separate from the tool
 * *implementations* (see src/tools/) so the AI-facing contract can be
 * versioned/reviewed independently of execution logic.
 */
export const TOOL_SCHEMAS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create a new file with the given text content, inside the sandboxed workspace.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Relative filename, e.g. "weather.js" or "src/index.js"' },
          content: { type: 'string', description: 'Full text content to write to the file' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the text content of a file in the sandboxed workspace.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Relative filename to read' },
        },
        required: ['filename'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_file',
      description: 'Overwrite an existing file with new content.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Relative filename to update' },
          content: { type: 'string', description: 'New full content for the file' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file from the sandboxed workspace.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Relative filename to delete' },
        },
        required: ['filename'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a directory of the sandboxed workspace.',
      parameters: {
        type: 'object',
        properties: {
          dirname: { type: 'string', description: 'Relative directory path (defaults to workspace root)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'zip_files',
      description: 'Bundle one or more files into a single zip archive.',
      parameters: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' }, description: 'Relative filenames to include' },
          outputName: { type: 'string', description: 'Name of the resulting .zip file' },
        },
        required: ['files', 'outputName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'unzip_file',
      description: 'Extract a zip archive into a directory in the sandboxed workspace.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Relative .zip filename to extract' },
          outputDir: { type: 'string', description: 'Relative directory to extract into' },
        },
        required: ['filename', 'outputDir'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_code',
      description:
        'Run a short Node.js, Python, or Bash snippet in a sandboxed, time-limited process and return stdout/stderr. Use for quick checks, not long-running programs.',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['node', 'python', 'bash'] },
          code: { type: 'string', description: 'The code to execute' },
        },
        required: ['language', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_document',
      description:
        'Read and parse a document file (PDF, DOCX, CSV, TXT, JSON, MD) from the sandboxed workspace. Returns the text content in a format suitable for analysis. For CSV, returns a structured preview with row count.',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Relative filename of the document to read' },
        },
        required: ['filename'],
      },
    },
  },
];
