const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');

function startServer() {
  const server = spawn(process.execPath, ['dist/server.js', '--stdio'], {
    cwd: __dirname + '/..',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let nextId = 1;
  let buffer = Buffer.alloc(0);
  const pending = new Map();

  server.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const header = buffer.subarray(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length: (\d+)/i);
      assert.ok(match, `missing Content-Length header: ${header}`);

      const length = Number(match[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + length;
      if (buffer.length < messageEnd) return;

      const message = JSON.parse(buffer.subarray(messageStart, messageEnd).toString('utf8'));
      buffer = buffer.subarray(messageEnd);

      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    }
  });

  function write(message) {
    const body = JSON.stringify(message);
    server.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  }

  function request(method, params) {
    const id = nextId++;
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    write({ jsonrpc: '2.0', id, method, params });
    return result;
  }

  function notify(method, params) {
    write({ jsonrpc: '2.0', method, params });
  }

  return { server, request, notify };
}

test('insert console.log action prefixes log label with search emoji', async (t) => {
  const lsp = startServer();
  t.after(() => lsp.server.kill());

  const stderr = [];
  lsp.server.stderr.on('data', (chunk) => stderr.push(chunk.toString('utf8')));
  lsp.server.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      throw new Error(`server exited with ${code}/${signal}: ${stderr.join('')}`);
    }
  });

  await lsp.request('initialize', {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
  });
  lsp.notify('initialized', {});

  const uri = 'file:///workspace/index.tsx';
  lsp.notify('textDocument/didOpen', {
    textDocument: {
      uri,
      languageId: 'typescriptreact',
      version: 1,
      text: 'function View() {\n  const width = 42;\n  return width;\n}\n',
    },
  });

  const actions = await lsp.request('textDocument/codeAction', {
    textDocument: { uri },
    range: {
      start: { line: 1, character: 8 },
      end: { line: 1, character: 13 },
    },
    context: { diagnostics: [] },
  });

  const insertAction = actions.find((action) => action.title === 'Insert console.log for "width"');
  assert.ok(insertAction, 'expected insert console.log action');
  assert.equal(
    insertAction.edit.changes[uri][0].newText,
    '\n  console.log("🔍 [index.tsx:3 View] width =", width);',
  );
});
