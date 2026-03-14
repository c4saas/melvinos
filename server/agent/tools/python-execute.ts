import type { ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

let pyodideInstance: any = null;
let pyodideFailedAt: number | null = null;
const PYODIDE_RETRY_DELAY_MS = 5 * 60 * 1000; // retry after 5 minutes

async function getPyodide(): Promise<any> {
  if (pyodideFailedAt !== null && Date.now() - pyodideFailedAt < PYODIDE_RETRY_DELAY_MS) {
    const retryInSecs = Math.ceil((PYODIDE_RETRY_DELAY_MS - (Date.now() - pyodideFailedAt)) / 1000);
    throw new Error(`Python runtime failed to load recently. Auto-retry in ~${retryInSecs}s.`);
  }
  if (!pyodideInstance) {
    pyodideFailedAt = null; // reset before attempt
    try {
      const { loadPyodide } = await import('pyodide');
      const loadPromise = loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/',
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Pyodide load timed out after 30s')), 30000),
      );
      pyodideInstance = await Promise.race([loadPromise, timeoutPromise]);
      console.log('Pyodide runtime loaded successfully');
    } catch (err) {
      pyodideFailedAt = Date.now();
      console.error('Failed to load Pyodide runtime:', err);
      throw new Error('Python runtime unavailable. Will retry automatically in 5 minutes.');
    }
  }
  return pyodideInstance;
}

async function runPython(code: string): Promise<string> {
  const pyodide = await getPyodide();

  // Set up stdout/stderr capture
  await pyodide.runPythonAsync(`
import sys
from io import StringIO
_stdout = StringIO()
_stderr = StringIO()
sys.stdout = _stdout
sys.stderr = _stderr
  `);

  try {
    await pyodide.runPythonAsync(code);
    const stdout = await pyodide.runPythonAsync('_stdout.getvalue()');
    const stderr = await pyodide.runPythonAsync('_stderr.getvalue()');

    // Reset streams
    await pyodide.runPythonAsync(`
_stdout = StringIO()
_stderr = StringIO()
sys.stdout = _stdout
sys.stderr = _stderr
    `);

    if (stderr) {
      return `Error: ${stderr}\n${stdout || ''}`.trim();
    }
    return stdout || 'Code executed successfully (no output)';
  } catch (execError: any) {
    return `Python error: ${execError.message}`;
  }
}

export const pythonExecuteTool: ToolDefinition = {
  name: 'python_execute',
  description:
    'Execute Python code in a sandboxed WebAssembly environment. Use this for calculations, data processing, generating outputs, or testing logic. The environment has access to standard Python libraries. Output is captured from stdout.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The Python code to execute',
      },
    },
    required: ['code'],
  },

  async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const code = String(args.code ?? '');
    if (!code.trim()) {
      return { output: '', error: 'Code cannot be empty' };
    }

    try {
      const output = await runPython(code);
      return { output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: '', error: `Execution error: ${message}` };
    }
  },
};
