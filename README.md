# Quick Log for Zed

A [Zed](https://zed.dev) extension that inserts annotated `console.log` statements with one Code Action.

Put your cursor on a variable, press the Code Actions key (`cmd-.` on macOS), pick **Insert console.log for "..."**, and a labeled log line is dropped on the next line.

Supported file types: `.js`, `.jsx`, `.ts`, `.tsx`.

## Why this is shipped as a language server

As of May 2026, Zed extensions cannot directly manipulate editor text — there is no API to register a command that edits text on a keybinding. See discussions [#46272](https://github.com/zed-industries/zed/discussions/46272) and [#33844](https://github.com/zed-industries/zed/discussions/33844).

The workaround is to ship the feature as a tiny custom Language Server that returns a **`textDocument/codeAction`** when you're on a variable. Zed already routes Code Actions through the LSP and applies the returned `WorkspaceEdit` for you. So the architecture is:

```
┌─────────────────────────┐                ┌────────────────────────────┐
│  Zed extension (WASM)   │  spawns node   │  LSP server (Node.js/TS)   │
│  src/quick_log.rs       │ ─────────────► │  server/dist/server.js     │
│  Cargo + zed_extension_ │                │  vscode-languageserver     │
│  api 0.7                │                │  textDocument/codeAction   │
└─────────────────────────┘                └────────────────────────────┘
                  ▲                                       │
                  │ user invokes Code Actions (cmd+.)     │
                  │                                       ▼
            ┌─────────────────────────────────────────────────┐
            │           Zed editor (JS/TS/JSX/TSX)            │
            │  Insert console.log for "subtotal"   ◄── pick   │
            └─────────────────────────────────────────────────┘
```

## Features

- **Insert console.log for selection** — uses the selected text as the variable name.
- **Word-at-cursor fallback** — if no selection, uses the identifier under the cursor.
- **Context-aware label** — generates `console.log("🔍 [<file>:<line> <enclosingFn>] <var> =", var)`.
  - The enclosing function is detected by a regex sweep (handles `function foo()`, `const foo = () =>`, methods, and classes).
- **Indent preservation** — the inserted line matches the indent of the original line.
- **Document-scoped actions** — when invoked anywhere on a file that already has `console.log`s:
  - Comment all console.log
  - Uncomment all console.log
  - Delete all console.log

## Prerequisites

- [Rust via rustup](https://rustup.rs) (Homebrew Rust **without** `rustup` will not work — Zed needs rustup itself; `brew install rustup` is fine).
- Node.js 18+ available on `$PATH` *or* via Zed's bundled Node (the extension calls `zed::node_binary_path()`).
- Zed 0.150+ (anything with `zed_extension_api` 0.7-compatible host).

## Architecture

The LSP is built into `server/dist/server.js` and embedded into the Rust extension at compile time. On startup, the extension writes that bundle into Zed's extension working directory and launches it with Zed's bundled Node.js runtime.

## Build the LSP locally (only if you're hacking on `server/src/`)

```bash
cd server
npm install
npm run build       # produces dist/server.js
npm test
```

> The Rust → WASM compile is performed automatically by Zed the first time you install the dev extension; you don't need to run `cargo build` yourself.

## Install as a Dev Extension

1. Open Zed.
2. Open the command palette → run `zed: install dev extension`.
3. Select the `quick-log/` directory.
4. Zed compiles `src/quick_log.rs` to WASM and registers the language server.

The extensions panel will show **Quick Log** under *Installed*, marked as *Dev*.

## Usage

1. Open a `.js` / `.jsx` / `.ts` / `.tsx` file.
2. Either:
   - Select a variable, **or**
   - Place the cursor on an identifier.
3. Open Code Actions (default keybinding: `cmd-.` on macOS, `ctrl-.` on Linux/Windows).
4. Pick **Insert console.log for "<variable>"**.

### Bind it to a single keystroke

Add to `~/.config/zed/keymap.json`:

```json
[
  {
    "context": "Editor && (language == JavaScript || language == TypeScript || language == TSX || language == JSX)",
    "bindings": {
      "ctrl-alt-l": "editor::ToggleCodeActions"
    }
  }
]
```

Then `ctrl-alt-l` opens the menu with **Insert console.log** at the top (it's marked `isPreferred: true`).

### Example

Given:

```ts
export function calculateTotal(items, discount) {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  return subtotal - discount;
}
```

Select `subtotal` on line 2, invoke Code Actions, pick the insert action:

```ts
export function calculateTotal(items, discount) {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  console.log("🔍 [calc.ts:3 calculateTotal] subtotal =", subtotal);
  return subtotal - discount;
}
```

## Project layout

```
quick-log/
├── extension.toml          # Zed extension manifest (declares the LSP)
├── Cargo.toml              # Rust crate, cdylib → wasm
├── src/
│   └── quick_log.rs        # WASM extension: returns the spawn Command
└── server/
    ├── package.json
    ├── tsconfig.json
    ├── src/server.ts       # LSP: textDocument/codeAction
    └── dist/server.js      # esbuild bundle (built artifact)
```

## Troubleshooting

- **"Failed to find node binary"** — Zed normally ships its own; if you see this, check `which node` and report the path in `zed: open log`.
- **No code action shows up** — confirm the file language in the Zed status bar is `JavaScript` / `TypeScript` / `TSX` / `JSX`. The `extension.toml` only registers for those.
- **Rebuild after editing `server/src/server.ts`** — run `npm run build`, then in Zed run `zed: install dev extension` again on this folder (this forces the WASM to recompile and re-embed the new bundle).
- **View logs** — `zed: open log` shows `language_server stderr` lines if the server crashes.

## Limitations

- No AST analysis — uses regex to detect the enclosing function/class. Won't correctly identify deeply nested arrow callbacks or anonymous IIFEs.
- Selection must be on a single line.
- Document-scoped actions (Comment/Uncomment/Delete all) only match lines that begin with `console.log` after optional indent + comment marker; they will not touch `console.log` calls that share a line with other statements.

## Future ideas

- AST-based context resolution via tree-sitter (would need to bundle a tiny WASM grammar in the LSP).
- Custom label format configurable through `initialization_options` on the LSP.
- Support `console.warn` / `console.error` / `console.table` variants as separate actions.
