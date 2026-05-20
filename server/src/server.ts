import {
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  createConnection,
  Position,
  ProposedFeatures,
  Range,
  TextDocuments,
  TextDocumentSyncKind,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    codeActionProvider: {
      codeActionKinds: [CodeActionKind.Empty, CodeActionKind.RefactorRewrite],
      resolveProvider: false,
    },
  },
}));

connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const actions: CodeAction[] = [];
  const insert = buildInsertLogAction(doc, params.range);
  if (insert) actions.push(insert);

  const docActions = buildDocumentScopedActions(doc);
  actions.push(...docActions);

  return actions;
});

interface Target {
  variable: string;
  anchorLine: number;
}

function resolveTarget(doc: TextDocument, range: Range): Target | null {
  const startOffset = doc.offsetAt(range.start);
  const endOffset = doc.offsetAt(range.end);

  if (endOffset > startOffset) {
    const selected = doc.getText(range).trim();
    if (selected.length > 0 && !selected.includes('\n')) {
      return { variable: selected, anchorLine: range.end.line };
    }
  }

  const lineText = getLineText(doc, range.start.line);
  const word = wordAt(lineText, range.start.character);
  if (!word || isLanguageKeyword(word) || /^\d/.test(word)) return null;
  return { variable: word, anchorLine: range.start.line };
}

function buildInsertLogAction(doc: TextDocument, range: Range): CodeAction | null {
  const target = resolveTarget(doc, range);
  if (!target) return null;

  const { variable, anchorLine } = target;
  const lineText = getLineText(doc, anchorLine);
  const indent = lineText.match(/^\s*/)?.[0] ?? '';
  const filename = basenameFromUri(doc.uri);
  const context = findEnclosingContext(doc, anchorLine);

  const locator = `[${filename}:${anchorLine + 2}${context ? ` ${context}` : ''}]`;
  const label = `${locator} ${variable} =`;
  const logLine = `${indent}console.log("${escapeForDoubleQuoted(label)}", ${variable});`;

  const insertPos = Position.create(anchorLine, lineText.length);
  const edit: TextEdit = {
    range: { start: insertPos, end: insertPos },
    newText: `\n${logLine}`,
  };

  const workspaceEdit: WorkspaceEdit = {
    changes: { [doc.uri]: [edit] },
  };

  return {
    title: `Insert console.log for "${variable}"`,
    kind: CodeActionKind.RefactorRewrite,
    isPreferred: true,
    edit: workspaceEdit,
  };
}

function buildDocumentScopedActions(doc: TextDocument): CodeAction[] {
  const text = doc.getText();
  const logRegex = /^[ \t]*\/?\/?\s*console\.log\(/;
  const lines = text.split(/\r?\n/);

  const matchingLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (logRegex.test(lines[i])) matchingLines.push(i);
  }

  if (matchingLines.length === 0) return [];

  const actions: CodeAction[] = [];

  actions.push({
    title: `Comment all console.log (${matchingLines.length})`,
    kind: CodeActionKind.RefactorRewrite,
    edit: {
      changes: {
        [doc.uri]: matchingLines
          .filter((i) => !/^\s*\/\//.test(lines[i]))
          .map((i) => commentLineEdit(lines[i], i)),
      },
    },
  });

  actions.push({
    title: `Uncomment all console.log (${matchingLines.length})`,
    kind: CodeActionKind.RefactorRewrite,
    edit: {
      changes: {
        [doc.uri]: matchingLines
          .filter((i) => /^\s*\/\/\s*console\.log\(/.test(lines[i]))
          .map((i) => uncommentLineEdit(lines[i], i)),
      },
    },
  });

  actions.push({
    title: `Delete all console.log (${matchingLines.length})`,
    kind: CodeActionKind.RefactorRewrite,
    edit: {
      changes: {
        [doc.uri]: matchingLines.map((i) => deleteLineEdit(lines, i)),
      },
    },
  });

  return actions.filter((a) => (a.edit?.changes?.[doc.uri]?.length ?? 0) > 0);
}

function commentLineEdit(line: string, lineNumber: number): TextEdit {
  const leading = line.match(/^\s*/)?.[0] ?? '';
  const rest = line.slice(leading.length);
  return {
    range: {
      start: Position.create(lineNumber, 0),
      end: Position.create(lineNumber, line.length),
    },
    newText: `${leading}// ${rest}`,
  };
}

function uncommentLineEdit(line: string, lineNumber: number): TextEdit {
  const newLine = line.replace(/^(\s*)\/\/\s?/, '$1');
  return {
    range: {
      start: Position.create(lineNumber, 0),
      end: Position.create(lineNumber, line.length),
    },
    newText: newLine,
  };
}

function deleteLineEdit(lines: string[], lineNumber: number): TextEdit {
  const isLast = lineNumber === lines.length - 1;
  return {
    range: {
      start: Position.create(lineNumber, 0),
      end: isLast
        ? Position.create(lineNumber, lines[lineNumber].length)
        : Position.create(lineNumber + 1, 0),
    },
    newText: '',
  };
}

function getLineText(doc: TextDocument, line: number): string {
  return doc.getText({
    start: Position.create(line, 0),
    end: Position.create(line + 1, 0),
  }).replace(/\r?\n$/, '');
}

function wordAt(line: string, character: number): string | null {
  if (line.length === 0) return null;
  const idx = Math.min(character, line.length - 1);
  const isWordChar = (c: string) => /[\w$]/.test(c);
  if (!isWordChar(line[idx])) {
    if (idx > 0 && isWordChar(line[idx - 1])) {
      return wordAt(line, idx - 1);
    }
    return null;
  }
  let start = idx;
  while (start > 0 && isWordChar(line[start - 1])) start--;
  let end = idx;
  while (end < line.length - 1 && isWordChar(line[end + 1])) end++;
  return line.slice(start, end + 1);
}

function basenameFromUri(uri: string): string {
  try {
    const parsed = URI.parse(uri);
    const path = parsed.fsPath || parsed.path;
    const segments = path.split(/[\\/]/);
    return segments[segments.length - 1] || '';
  } catch {
    return '';
  }
}

function findEnclosingContext(doc: TextDocument, line: number): string {
  const patterns: RegExp[] = [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    /([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/,
    /(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)/,
  ];

  for (let i = line; i >= Math.max(0, line - 200); i--) {
    const text = getLineText(doc, i);
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1] && !isLanguageKeyword(match[1])) {
        return match[1];
      }
    }
  }
  return '';
}

function isLanguageKeyword(name: string): boolean {
  return [
    'if', 'else', 'for', 'while', 'switch', 'case', 'return',
    'try', 'catch', 'finally', 'do', 'typeof', 'instanceof',
    'new', 'in', 'of', 'this', 'super', 'function', 'const',
    'let', 'var', 'class', 'extends', 'implements', 'import',
    'export', 'from', 'as', 'default', 'await', 'async',
    'yield', 'true', 'false', 'null', 'undefined', 'void',
    'break', 'continue', 'throw', 'delete', 'interface', 'type',
    'enum', 'namespace', 'public', 'private', 'protected',
    'static', 'readonly', 'abstract',
  ].includes(name);
}

function escapeForDoubleQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

documents.listen(connection);
connection.listen();
