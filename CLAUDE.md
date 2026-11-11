# Executor

Electron + TypeScript + React desktop app for building and running multi-agent workflows. macOS only for now.

## Layout

| Path | What lives there |
|---|---|
| `src/main/index.ts` | App lifecycle, window, IPC handlers |
| `src/main/runRegistry.ts`, `stateFile.ts` | Live runs per window; reading and writing saved state |
| `src/main/runEngine.ts` | Runs a workflow: scheduling, limits, tool loop, approvals. Provider-neutral |
| `src/main/{anthropic,openai,gemini}Client.ts` | One `ModelSession` implementation per provider |
| `src/main/agentEnvironment.ts`, `mcp*.ts` | MCP server connections, skills and memory docs for a run |
| `src/main/registry.ts`, `clawhub.ts` | Installing servers and skills from untrusted registries |
| `src/main/listCache.ts` | Remembers each registry's opening list on disk so its Marketplace tab fills in at once |
| `src/main/secrets.ts` | API keys, encrypted with `safeStorage` |
| `src/preload/index.ts` | The only bridge to the renderer (`window.executor`) |
| `src/shared/` | Types and pure logic used by both sides: `types.ts`, `ipc.ts` (the IPC contract), `persisted.ts` (saved-state shape), `pricing.ts`, `mcpServers.ts`, `registry.ts`, `skills.ts` |
| `src/renderer/src/store.ts` | The zustand store: all app state and actions |
| `src/renderer/src/runState.ts` | Pure reducer that applies run events to a workflow |
| `src/renderer/src/saveScheduler.ts`, `batcher.ts` | When state is saved; batching of streamed run events |
| `src/renderer/src/pages/`, `components/` | UI |

The renderer is sandboxed and talks to main only through `ExecutorBridge` (`src/shared/types.ts`). Every channel, with its arguments and result, is declared once in `src/shared/ipc.ts`; preload and main are typed from it. To add or change a call: edit the contract, then follow the compile errors through `ExecutorBridge`, `src/preload/index.ts`, the `handlers` map in `src/main/index.ts` and the browser preview in `src/renderer/src/bridge.ts`.

## Checks

Everything is fast. The whole suite takes about 2 seconds, so do not spend effort avoiding it.

| After | Run |
|---|---|
| Any code edit | `npm run -s check` (typecheck, then tests related to uncommitted changes) |
| One file, mid-task | `npm run -s test:related -- <file>` |
| Editing `package.json`, a tsconfig, `electron.vite.config.ts`, preload or the IPC contract | `npm run -s check:full` (typecheck, all tests, build) |

- If a check passed and no relevant file has changed since, do not run it again.
- Tests are pure: no app, network or API keys needed. They sit beside the code as `*.test.ts`.
- Do not run `npm run package` or launch the app unless asked. Packaging overwrites `dist/mac-arm64/Executor.app`, which may be the copy currently running.
- `npm run dev:web` serves the renderer alone in a browser for UI checks.

## Reading the code

- Never read `package-lock.json`, `out/` or `dist/`.
- Search these instead of reading them whole: `src/renderer/src/styles.css` (2,000 lines), `src/shared/skills.ts`, `src/renderer/src/data/catalog.ts`, `src/renderer/src/data/seed.ts` (data tables).
- `AUDIT.md` lists known issues by ID with file locations.

## Conventions

- No `any`, no semicolons, single quotes, two-space indent, 120 columns.
- Registry and ClawHub data is untrusted. Commands are built in `src/shared/registry.ts` from validated fields only; do not pass registry strings to a shell or a path.
- Secrets never go to the renderer or the logs.
- Comments say why, in plain words. Match the existing tone.
- New dependencies need the user's approval first.
