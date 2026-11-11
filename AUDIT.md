# Executor audit

Audited 2026-11-11 at commit `d611470`. Nothing in the repo was changed; this file is the only addition.

**How to use this:** every finding has an ID (`R1`, `S2`, ...). Tell me which IDs to implement. Each approved ID becomes one commit unless noted. Findings marked **behavior change** alter what the user sees and need an explicit yes.

**Fields:** Effort S (under an hour) / M (a few hours) / L (a day or more). Risk is the chance the fix itself breaks something. Within each area, findings are sorted by impact divided by effort.

## Summary

The codebase is in better shape than most at this stage: strict TypeScript with no `any`, a sandboxed renderer, keys in `safeStorage`, untrusted registry data validated before it becomes a command, and 174 behavior-named tests that run in under a second. Most of the real problems are at the edges of a run:

- A run keeps going (and billing) with no UI attached if the window is closed or reloaded (`R1`).
- State can be lost or overwritten in three specific situations (`R2`, `R3`, `R4`).
- Streaming sends the full accumulated output every 150 ms and re-renders most of the canvas page each time (`P1`).
- IPC handlers trust the renderer's arguments, including file paths that main then reads or hands to MCP servers (`S1`, `S2`).
- Verification is already cheap (about 2 s for everything). The token savings are in telling agents that, and in stopping them from building, packaging or reading large files (`V1`).

## Measurements

| Check | Wall time | Notes |
|---|---|---|
| `vitest run` (7 files, 174 tests) | 1.5 s | 0.83 s inside vitest |
| `vitest related src/shared/pricing.ts` | 1.0 s | 4 of 7 files, 102 tests |
| `npm run typecheck` (both projects) | 0.6 s | TypeScript 7, no incremental needed |
| `electron-vite build` | 0.6 s | Built to a scratch folder |
| `npm run package` | not run | It overwrites `dist/mac-arm64/Executor.app`, which was running during the audit |

| Build output | Size |
|---|---|
| `out/renderer/assets/index-*.js` (single chunk) | 1.13 MB |
| `material-symbols-outlined-*.woff2` | 4.0 MB, for 40 icons |
| `out/main/index.js` (dependencies external) | 86 KB |
| `app.asar` in the packaged app | 113 MB |
| Cold import of the three model SDKs plus the MCP client in Node | about 350 ms |

`npm audit`: 6 moderate, all one `minimatch` advisory reached through `electron-builder` (build-time only, see `S9`). Electron is 45.2.1; 45.3.0 is out.

---

## Reliability

### R1. Runs outlive their window and keep billing
- **Where:** `src/main/index.ts:96-104` (`run:start`), `:191-197` (quit handlers); `src/renderer/src/store.ts:150-169` (`restoreWorkflow`)
- **Wrong:** Events go only to the `webContents` that started the run. If that window is closed (the app stays in the Dock on macOS), reloaded, or its renderer crashes, `emit` silently drops events but the run continues calling models and tools. The reopened window marks the workflow "Interrupted" while main is still spending. Also, `before-quit` calls `stop()` but does not wait, so MCP child processes (`npx`, `uvx`, `docker run`) can be left behind.
- **Why it matters:** Invisible spend and tool actions with nobody able to approve or stop them.
- **Fix:** Track runs by `webContents` id; stop them on `destroyed`, `render-process-gone` and main-frame navigation. On `before-quit`, `preventDefault`, await every `handle.done` with a 5 s cap, then quit.
- **Effort:** S. **Risk:** low. **Behavior change** (closing the window stops its runs; see question 2).
- **Verify:** Unit test with a fake sender that reports destroyed; manual: start a run, close the window, confirm no further API calls in the log and no leftover child processes (`pgrep -f mcp`).

### R2. Saves are starved during a run and never flushed on quit
- **Where:** `src/renderer/src/store.ts:648-660`
- **Wrong:** The save is a pure 400 ms debounce. While any agent streams, an event arrives at least every 150 ms, so the timer is reset forever and nothing is saved until output pauses. Nothing flushes the pending save when the window closes or the app quits.
- **Why it matters:** A crash or quit mid-run loses the run's output and any canvas edits made since it started. Edits made within 400 ms of quitting are always lost.
- **Fix:** Throttle with a maximum wait (save at most once per 2 s, at least once per 2 s while dirty). Flush on `pagehide` and before the quit in `R1`.
- **Effort:** S. **Risk:** low.
- **Verify:** Unit test with fake timers: continuous changes every 100 ms still produce a save within 2 s.

### R3. Unreadable saved state is silently replaced with sample data
- **Where:** `src/renderer/src/store.ts:258-282`
- **Wrong:** If `state.json` fails to parse, the app logs to the console, seeds sample data, and the next save overwrites the user's file. There is no shape check either: the JSON is cast to `Persisted`, so a file that parses but has the wrong shape (older version, partial write from another tool) crashes rendering later.
- **Why it matters:** One bad write means every project and agent is gone with no copy.
- **Fix:** In main, before the first overwrite of an unreadable file, rename it to `state.corrupt-<timestamp>.json`. Add a `version` field and a small shape validator in `hydrate`; treat a failed validation like a parse failure. Tell the user once, in the UI.
- **Effort:** S. **Risk:** low.
- **Verify:** Unit tests for the validator; manual: corrupt `state.json`, launch, confirm the backup file exists.

### R4. First launch offline, or any `loadState` error, leaves a blank window
- **Where:** `src/renderer/src/store.ts:251-283`, `src/renderer/src/App.tsx:17,44`; `src/renderer/src/data/catalog.ts:239`; `src/main/agentEnvironment.ts:31-42`
- **Wrong:** `hydrate()` is called with `void` and has no catch. On first run it downloads two preinstalled skills (`webapp-testing`, `mcp-builder`) from GitHub, one after another, with no timeout. If that fetch fails or `state:load` rejects, `hydrated` never becomes true and `App` renders `null` forever. There is also no React error boundary, so any render exception gives the same blank window.
- **Why it matters:** The worst first impression possible, with no message.
- **Fix:** Make preinstall downloads best-effort (catch per package, retry lazily on first use, which `loadSkill` already does). Add a timeout to the skill fetch. Catch in `hydrate` and show an error screen with a retry. Add one top-level error boundary.
- **Effort:** S. **Risk:** low.
- **Verify:** Unit test `hydrate` with a bridge whose `downloadPackage` rejects; manual: first launch with Wi-Fi off.

### R5. No safety net if a run throws outside a node
- **Where:** `src/main/runEngine.ts:447-465`, `src/main/index.ts:103`
- **Wrong:** If `execute()` rejects (for example `environment.prepare` or `close` throws unexpectedly), no `end` event is emitted, the workflow stays "running" in the UI until restart, and `handle.done.finally(...)` produces an unhandled rejection. Main has no `unhandledRejection` or `uncaughtException` handler; Electron's default for the latter is a modal error dialog.
- **Fix:** Wrap `execute()` so any throw emits `end` with `outcome: 'failed'`. Add both process handlers in main that log and, for runs, fail them cleanly.
- **Effort:** S. **Risk:** low.
- **Verify:** Unit test: an environment whose `prepare` throws still yields an `end` event.

### R6. Config files are written non-atomically and can race
- **Where:** `src/main/registry.ts:55,61`, `src/main/clawhub.ts:181,187`, `src/main/mcpSetup.ts:62`, `src/main/secrets.ts:12`, `src/main/index.ts:27-32`
- **Wrong:** Three JSON stores do read-modify-write with a plain `writeFile`; two overlapping installs can lose one, and a crash mid-write truncates the file. `writeAtomic` exists but only `state.json` and manifests use it, and it uses a fixed `.tmp` name, so two overlapping state saves can collide. A corrupt `registry-servers.json` makes every run fail, because `serverSpec` rethrows the parse error.
- **Fix:** One small `jsonStore` helper in main (read with ENOENT default, serialized atomic write with a unique temp name), used by all four files and by secrets. This also removes three copies of the same read function (`Q2`).
- **Effort:** S. **Risk:** low.
- **Verify:** Unit test: 20 concurrent updates all land; a corrupt file surfaces a clear error.

### R7. No retry or backoff for rate limits and dropped streams
- **Where:** `src/main/runEngine.ts:321`, `src/main/anthropicClient.ts:151-203`, `openaiClient.ts:83`, `geminiClient.ts:116`
- **Wrong:** Up to three agents run in parallel. A 429, a 5xx, or a stream that drops mid-reply fails that agent and skips everything downstream. The Anthropic and OpenAI SDKs retry the initial request by default, but nothing retries once a stream has started, and I did not confirm what the Gemini SDK does. There is no idle timeout on a stalled stream; it waits for the SDK's overall timeout.
- **Why it matters:** One transient error wastes the spend of every upstream agent.
- **Fix:** In `runNode`, retry a failed `session.turn` up to 2 times with jittered backoff (honoring `retry-after`) when the error is retryable and the turn produced no tool results. Add an idle watchdog (for example 90 s without a stream event). Sessions only append history after a successful turn, so a retry is safe for Anthropic and OpenAI. Gemini updates `previousId` mid-stream (`geminiClient.ts:165-170`); that must move to after success first.
- **Effort:** M. **Risk:** medium (touches billing accounting; partial attempts may be billed and must be counted).
- **Verify:** Engine tests with a fake client that fails once then succeeds, fails three times, and stalls.

### R8. The Anthropic client retries unknown errors as if they were bad tool JSON
- **Where:** `src/main/anthropicClient.ts:198-201`
- **Wrong:** Any error that is not an `APIError` is retried up to twice, on the assumption that it is unparseable tool input. A bug or an unexpected SDK error gets the same treatment, quietly tripling the cost of that turn.
- **Fix:** Retry only the specific parse failure; rethrow everything else.
- **Effort:** S. **Risk:** low. I need to check which error class the SDK throws before changing it.
- **Verify:** New Anthropic client tests (see `V4`).

### R9. ClawHub recheck runs for every skill on every agent, serially
- **Where:** `src/main/agentEnvironment.ts:114-127`, `src/main/clawhub.ts:192-200`
- **Wrong:** Each skill costs two HTTP requests (15 s timeout each) per node per run, one skill at a time. Five agents sharing one skill make ten requests. A slow ClawHub delays every agent's start.
- **Fix:** Memoize the recheck per run inside `createAgentEnvironment`, and check a node's skills in parallel.
- **Effort:** S. **Risk:** low.
- **Verify:** Unit test counting fetches for two nodes sharing a skill.

### R10. Tool image results are unbounded and the MIME type is unchecked
- **Where:** `src/main/mcpConnection.ts:35-47`
- **Wrong:** Text results are cut at 100,000 characters, but image blocks pass through at any size and `mimeType` is cast to `'image/png'` without checking it is one of the four types the APIs accept.
- **Why it matters:** One large screenshot can blow an agent's budget or make the next request fail with a confusing API error.
- **Fix:** Reject unsupported MIME types and oversized images with a text block explaining why.
- **Effort:** S. **Risk:** low.
- **Verify:** Extend `mcpConnection.test.ts` with the fixture server.

---

## Security

Electron hardening is already right (see "Things that are fine"). These are the gaps.

### S1. IPC handlers do not validate arguments
- **Where:** `src/main/index.ts:42-150`
- **Wrong:** Every handler trusts its TypeScript annotation. Concrete consequences:
  - `key:save` / `key:remove` (`:89-94`): `provider` is used to build a file name (`secrets.ts:27`). A value like `../../x` writes or deletes a file ending in `-key.enc` outside `userData`.
  - `library:reveal` (`:67-70`): `startsWith(libraryRoot + sep)` without resolving, so `<library>/../../anything` passes.
  - `run:start` (`:96-104`): `request` is unchecked; a duplicate `runId` silently replaces the handle of a live run, which then cannot be stopped.
  - `state:save` (`:52`): any string of any size.
- **Why it matters:** The renderer is sandboxed and has a CSP, so this needs a renderer compromise first. Validation at the boundary is the second layer that makes such a compromise much less useful.
- **Fix:** A small validator per channel (hand-written guards; no new dependency) defined beside the channel in the shared IPC contract from `Q1`. Also reject calls whose `event.senderFrame` is not the app's main frame.
- **Effort:** M. **Risk:** low.
- **Verify:** Table-driven unit tests of each validator with hostile inputs.

### S2. Main reads any path the renderer names, and passes any folder to MCP servers
- **Where:** `src/main/agentEnvironment.ts:60-67` (memory docs), `src/main/mcpSetup.ts:58-63` (folders), `src/shared/mcpServers.ts:90-95`
- **Wrong:** Memory doc paths come from `RunRequest`, and folder lists come from `mcp:save-folders`. Neither is checked against what the user actually chose in the native picker. Main will read any text file under 500 KB and send it to a model, and will grant the filesystem server any folder. Folder strings are also appended to the server's command line as-is, so a value starting with `--` is read as a flag.
- **Fix:** Main records paths returned by `docs:pick` and `mcp:pick-folders` (persisted in `userData`) and refuses anything else. Reject folder values that are not absolute paths.
- **Effort:** M. **Risk:** medium (existing saved agents reference paths that are not on the new allowlist; needs a one-time migration that trusts what is already saved). See question 4.
- **Verify:** Unit tests for the allowlist; manual: attach a doc, restart, run.

### S3. Built-in MCP servers run unpinned code
- **Where:** `src/shared/mcpServers.ts:27-62`
- **Wrong:** Registry servers must pin an exact version, but the eight built-in ones do not: `npx -y @modelcontextprotocol/server-filesystem`, `@playwright/mcp@latest`, `uvx mcp-server-git`, and an untagged Docker image. Each launch runs whatever was published most recently.
- **Why it matters:** A compromised release of any of these runs on the user's Mac with their folders and GitHub token, with no review step.
- **Fix:** Pin exact versions (and a Docker digest), with a comment giving the date reviewed. Bump deliberately.
- **Effort:** S. **Risk:** low. **Behavior change** (servers stop auto-updating).
- **Verify:** `mcp:check` each server after pinning.

### S4. Base-URL overrides still work in the packaged app
- **Where:** `src/main/anthropicClient.ts:26`, `openaiClient.ts:12`, `geminiClient.ts:13`, `registry.ts:7`, `clawhub.ts:18`
- **Wrong:** The comments say the URL is pinned so an environment variable cannot send the saved key elsewhere, but `EXECUTOR_API_URL` and its siblings do exactly that in production builds.
- **Fix:** Honor them only when `!app.isPackaged` (or drop them and inject the URL in tests). See question 5.
- **Effort:** S. **Risk:** low.
- **Verify:** Existing client tests still pass; unit test the gate.

### S5. No permission handler, and navigation guards are per-window only
- **Where:** `src/main/index.ts:152-181`
- **Wrong:** There is no `session.setPermissionRequestHandler`, so permission requests (camera, notifications, and so on) fall to Electron's defaults. The `will-navigate` and window-open guards are attached to one window instance instead of every `webContents`.
- **Fix:** Deny all permission requests. Move the guards into `app.on('web-contents-created')`.
- **Effort:** S. **Risk:** low.
- **Verify:** Manual check that external links still open in the browser.

### S6. CSP is missing three directives, and the app loads from `file://`
- **Where:** `electron.vite.config.ts:4-10`, `src/main/index.ts:180`
- **Wrong:** The policy is good but lacks `object-src 'none'`, `base-uri 'none'` and `form-action 'none'`. Loading over `file://` means the renderer runs with `--allow-file-access-from-files`; Electron's guidance is to serve the app from a custom protocol instead.
- **Fix:** Add the three directives now (S). Moving to an `app://` protocol with `protocol.handle` is a separate, optional step (M, medium risk: asset and font URLs must be retested).
- **Verify:** Build, launch, confirm no CSP violations in the console and that fonts load.

### S7. Packaging is not hardened for distribution
- **Where:** `package.json:46-51`
- **Wrong:** Ad-hoc signing (`identity: "-"`), `hardenedRuntime: false`, and no Electron fuses, so the binary can still be run as plain Node (`ELECTRON_RUN_AS_NODE`) and accepts `--inspect`.
- **Fix:** Only matters if anyone else will run the app (question 1). If so: Developer ID signing, hardened runtime, notarization, and fuses via electron-builder's `electronFuses` option (no new dependency).
- **Effort:** M. **Risk:** medium.

### S8. Secrets are decrypted just to check that they exist
- **Where:** `src/main/secrets.ts:39-42`, `src/main/mcpSetup.ts:46-48`
- **Wrong:** `apiKeyStatus` and `serverSetup` decrypt every key in order to return booleans, at every app start. Plaintext keys are in memory more often than needed.
- **Fix:** Check that the `.enc` file exists instead. Also fixes part of `P3`.
- **Effort:** S. **Risk:** low.

### S9. Dependency advisories
- **Wrong:** Six moderate advisories, all `minimatch` (ReDoS) under `electron-builder`. It only runs at package time on your own globs, so real exposure is negligible. `npm audit fix --force` would downgrade `electron-builder` to 25.1.0; do not run it.
- **Fix:** Add an `overrides` entry for `minimatch` if a patched version in range exists, otherwise leave it. Take the Electron 45.3.0 patch release and the in-range SDK updates in one dependency commit.
- **Effort:** S. **Risk:** low for patches. `@google/genai` 3.x is a major version; leave it for a separate decision.
- **Verify:** `npm run check:full`, package, launch.

---

## Performance

### P1. Streaming re-sends the whole output and re-renders the page every 150 ms
- **Where:** `src/main/runEngine.ts:309-319` (flush), `src/renderer/src/store.ts:450-462` (`applyRunEvent`), `src/renderer/src/pages/canvas/FlowCanvas.tsx:136-139`
- **Wrong:**
  1. Each flush sends the full accumulated text as an `output` event. A long reply is serialized over IPC hundreds of times; the total grows with the square of its length.
  2. Each flush is two IPC messages (`usage`, `output`) per agent, and each one is a separate store update.
  3. `applyRunEvent` rebuilds every project object, including ones the run does not touch, so everything subscribed to `activeProject` or `activeWorkflow` re-renders per event: Rail, Header, Ribbon, FlowCanvas, Inspector, RunControl and the Workflows tab. The edge list is recomputed each time because it depends on `workflow.nodes`, so every edge re-renders too.
- **Why it matters:** With three agents streaming, that is roughly 40 full canvas-page renders per second. It is the main source of jank during a run.
- **Fix:** (a) Send text deltas and let the renderer append; send the full text once at the end of each turn as the source of truth. (b) Emit one combined progress event per flush. (c) In the renderer, queue events and apply them once per animation frame in a single `set`. (d) Return the same project and workflow objects when nothing in them changed. (e) Derive the "which nodes are active" set with a selector so the edge memo only changes when it does.
- **Effort:** M. **Risk:** medium (changes the `RunEvent` contract; `runState.test.ts` and `runEngine.test.ts` both cover it).
- **Verify:** Existing tests updated; a new test that deltas reassemble to the final text; React Profiler before and after on a three-agent run.

### P2. All model SDKs load before the window is created
- **Where:** `src/main/index.ts:6-12` through `modelClients.ts`, `mcpConnection.ts`
- **Wrong:** Main statically imports the Anthropic, OpenAI and Google SDKs and the MCP client. Cold, they take about 350 ms to import in Node, all before `createWindow`.
- **Fix:** `await import()` them inside `run:start`, `key:save` and `mcp:check`. Create the window before registering the heavy handlers.
- **Effort:** S. **Risk:** low.
- **Verify:** Log time from process start to `ready-to-show` before and after (five launches each).

### P3. Hydration makes five sequential IPC round trips before first paint
- **Where:** `src/renderer/src/store.ts:251-258`, `src/main/mcpSetup.ts:52-56`
- **Wrong:** `hydrate` awaits key status, MCP setups, registry servers, ClawHub skills and saved state one after another, and nothing renders until all finish. `allServerSetups` re-reads `registry-servers.json` once per server and decrypts every secret.
- **Fix:** One `app:bootstrap` handler that gathers everything in parallel and reads each file once. Combine with `S8`.
- **Effort:** S. **Risk:** low.
- **Verify:** Same startup timing as `P2`.

### P4. A 4 MB icon font ships for 40 icons
- **Where:** `src/renderer/src/main.tsx:4`, `src/renderer/src/components/ui.tsx:3-9`
- **Wrong:** The full Material Symbols variable font is loaded and decoded at startup. Icons are ligatures, so until it loads they can flash as words like `precision_manufacturing`.
- **Fix:** Either subset the font to the 40 names at build time, or replace `Icon` with inline SVGs. Either needs a decision on tooling: subsetting needs a dev dependency (for example `subset-font`); SVGs need the icon paths copied in or `@material-symbols/svg-400` as a dev dependency.
- **Effort:** M. **Risk:** low (visual check of every icon).
- **Verify:** Build output size; screenshot each page.

### P5. Renderer-only packages are shipped twice
- **Where:** `package.json:17-29`
- **Wrong:** `react`, `react-dom`, `@xyflow/react`, `zustand`, both `@fontsource-variable` packages and `material-symbols` are bundled into `out/renderer` by Vite and also copied into `app.asar` as `dependencies` (about 25 MB, 12 MB of it `material-symbols`).
- **Fix:** Move them to `devDependencies`, which is the electron-vite convention. Only packages that main imports at run time stay in `dependencies`.
- **Effort:** S. **Risk:** low.
- **Verify:** `npm run package`, launch the packaged app, compare `app.asar` size.

### P6. The dot grid redraws every dot on every mouse move
- **Where:** `src/renderer/src/pages/canvas/DotMatrix.tsx:30-66`
- **Wrong:** About 2,000 `arc` + `fill` calls per frame, each building a new `rgba()` string, on every mouse move, pan and zoom. It does stop when idle, which is good.
- **Fix:** Measure first. If it shows up in a profile: draw the resting grid once to an offscreen canvas and only redraw the dots near the cursor.
- **Effort:** M. **Risk:** low. Low priority; skip unless panning feels slow.

---

## Code quality

### Q1. One typed IPC contract shared by main, preload and renderer
- **Where:** `src/shared/types.ts:191-222`, `src/preload/index.ts`, `src/main/index.ts:42-150`
- **Wrong:** `ExecutorBridge` types the renderer side, but channel names are string literals written twice, and each handler's argument types are annotated by hand. A renamed channel or changed argument fails at run time, not compile time.
- **Fix:** `src/shared/ipc.ts` exports one map of channel name to `{ args, result }`. Preload is generated by a typed loop over it; main registers through a typed `handle()` wrapper, which is also where the `S1` validators attach.
- **Effort:** M. **Risk:** low. Do this before `S1`.
- **Verify:** `npm run typecheck`; rename a channel in one place and confirm it fails to compile.

### Q2. Repeated helpers
- **Where and fix:**
  - "Read JSON or return `{}` on ENOENT" appears in `registry.ts:35`, `clawhub.ts:157` and `mcpSetup.ts:21`. Covered by `R6`.
  - `error instanceof Error ? error.message : String(error)` appears eight times in main. One `messageOf` in `shared/`.
  - The open-dialog code is duplicated in `index.ts:72-82` and `:139-149`.
  - `{ folders: {}, secrets: [] }` is written out in `runState.ts:73` although `emptySetup()` exists.
- **Effort:** S. **Risk:** low.

### Q3. Small dead or stale code
- `KEYS_PAGE` in `src/renderer/src/components/SettingsDialog.tsx:12` is unused (it is the only unused local in the codebase).
- The MCP client reports version `0.2.0` (`mcpConnection.ts:79`) while `package.json` says `0.1.0`.
- **Fix:** Remove the constant; read the version from `app.getVersion()`. Turn on `noUnusedLocals` and `noUnusedParameters` in both tsconfigs so this cannot recur.
- **Effort:** S. **Risk:** low.

### Q4. `index.ts` and `store.ts` mix concerns
- **Where:** `src/main/index.ts` (IPC, library file logic, window, lifecycle), `src/renderer/src/store.ts` (660 lines: persisted data, UI flags, IPC calls, layout, and `window.confirm` inside actions at `:508`, `:552`, `:580`)
- **Fix:** Main: `ipc.ts`, `library.ts`, `window.ts`. Store: split into slices (workspace, run, marketplace, ui) and move the confirms to the components that trigger them. Pure helpers (`layeredPositions`, `restoreWorkflow`) move out and become testable.
- **Effort:** M. **Risk:** medium for the store (wide diff). Worth doing only after `P1`, `R2` and `R3` have landed, since they touch the same code.

### Q5. Tests live in files that do not match what they test
- **Where:** `src/main/runEngine.test.ts:554-616` (graph and pricing tests), `src/main/mcpConnection.test.ts` (also tests `shared/mcpServers` and `shellPath`), `src/renderer/src/runState.test.ts` (also tests `usage.ts`)
- **Fix:** Move those blocks to `shared/pricing.test.ts`, `shared/runGraph.test.ts`, `shared/mcpServers.test.ts` and `renderer/src/usage.test.ts`. No test is removed or changed. An agent editing `pricing.ts` then finds its tests by name.
- **Effort:** S. **Risk:** low.
- **Verify:** Test count stays at 174.

### Q6. No linter or formatter
- **Wrong:** Style is consistent today because one author (and one model) wrote it. Nothing enforces it.
- **Fix:** Optional. If you want one, Biome is a single fast binary for lint and format (new dev dependency: `@biomejs/biome`). Otherwise `Q3`'s compiler flags cover the highest-value checks. See question 6.

---

## Verification cost and agent tokens

The headline: **everything already runs in about 2 seconds**, so there is nothing to gain by pruning tests, and targeted runs save under a second. The savings are in instructions and output size.

### V1. Add `CLAUDE.md` and three scripts
- **Fix:** Scripts in `package.json` (no new dependencies):
  - `"test": "vitest run --reporter=dot"` (short output)
  - `"test:related": "vitest related --run --reporter=dot"` (use: `npm run -s test:related -- src/shared/pricing.ts`)
  - `"check": "npm run -s typecheck && vitest run --changed --reporter=dot"` (typecheck plus tests related to uncommitted changes)
  - `"check:full": "npm run -s typecheck && vitest run --reporter=dot && electron-vite build"`
- `CLAUDE.md` (about 60 lines) covering:
  - Architecture in ten lines: main / preload / renderer / shared, where the engine, clients, store and IPC contract live.
  - Which command for which change: `npm run -s check` after any edit; `check:full` only when touching `electron.vite.config.ts`, tsconfigs, `package.json`, preload or the IPC contract.
  - Do not re-run a check that passed if no relevant file changed since.
  - Do not run `npm run package` or launch the app unless asked; packaging overwrites the app in `dist/` that may be running.
  - Do not read `package-lock.json`, `out/`, `dist/`; read `styles.css`, `shared/skills.ts`, `data/catalog.ts` and `data/seed.ts` by searching, not whole.
  - Tests are pure and need no app, network or keys.
- **Effort:** S. **Risk:** none.

### V2. Large files agents are likely to read whole
| File | Size | Note |
|---|---|---|
| `package-lock.json` | 7,361 lines, 258 KB | Never useful to read |
| `src/renderer/src/styles.css` | 1,989 lines | Largest source file; consider splitting per page later (M, low priority) |
| `src/shared/skills.ts` | 293 lines, mostly a data table | |
| `src/renderer/src/data/catalog.ts`, `seed.ts` | 285 and 258 lines of data | |
- `out/` and `dist/` (371 MB) are already git-ignored, so search tools skip them. Add `.vitest/` to `.gitignore`: the JSON reporter writes there (I triggered it once during the audit and deleted it).

### V3. Tests to merge or remove: none
I read every test title and sampled the bodies. They are named for behavior, use fakes instead of mocks of internals, and the one integration test (a real MCP server over stdio and HTTP) is still fast. There are no duplicates worth removing. The only change I recommend is the reorganization in `Q5`.

### V4. Coverage gaps worth filling (these add tests)
- `anthropicClient.ts` has no tests, while the OpenAI and Gemini clients do. It holds the most intricate logic: `billedUsage`, `replayableContent` after a fallback, and the retry in `R8`.
- `store.ts`: `hydrate`, `restoreWorkflow` and the save subscription (needed for `R2`, `R3`, `R4`).
- `secrets.ts` and the IPC validators (with `S1`).
- **Effort:** M. **Risk:** none.

---

## Questions

1. **Distribution.** Is Executor only for you on this Mac, or will other people install it? That decides whether `S7` matters at all.
2. **Closing the window mid-run** (`R1`). Should the run stop (simple, recommended), or keep going and re-attach when the window reopens (more work)?
3. **What downstream agents receive.** `runEngine.ts:360` passes only the final turn's text downstream, while the Inspector shows every turn joined together. Is "final reply only" intended?
4. **Path allowlist** (`S2`). Is it acceptable that memory docs and MCP folders must come from the native picker, with existing saved paths trusted once at migration?
5. **`EXECUTOR_*_URL` overrides** (`S4`). Do you use them with a proxy in the packaged app, or are they only for tests?
6. **Linting** (`Q6`). Add Biome, or keep the compiler as the only gate?

## New dependencies

None are required for anything in the Top 5. Optional, each only if you approve the item:

| Package | For | Kind |
|---|---|---|
| `subset-font` or `@material-symbols/svg-400` | `P4`, depending on approach | dev |
| `@biomejs/biome` | `Q6` | dev |
| `knip` (run once with `npx`, not installed) | A second pass for unused exports; `tsc` found only one unused local | none |

## Top 5 to do first

1. **`V1`** CLAUDE.md and check scripts. Smallest change, and it lowers the cost of every change after it.
2. **`R1`** Stop runs when their window goes away, and wait for cleanup on quit. Prevents invisible spend.
3. **`R2` + `R3` + `R4`** State safety: throttled saves with flush, backup instead of overwrite, no blank window. Three small commits.
4. **`P1`** Delta streaming and batched updates. The one change users will feel during a run.
5. **`Q1` then `S1`, plus `S3`** Typed IPC contract with validation at the boundary, and pinned built-in servers.

## Things that are fine, leave alone

- **Electron window settings:** `contextIsolation`, `sandbox`, no `nodeIntegration`, no `remote`, `webSecurity` untouched, window-open denied, navigation blocked, `show: false` until ready.
- **Preload surface:** a fixed list of functions, no raw `ipcRenderer`, and `onRunEvent` returns an unsubscribe that `App.tsx` uses.
- **Key handling:** `safeStorage`, mode `0600`, keys never returned to the renderer, never logged, SDK base URLs set explicitly, and child processes get `getDefaultEnvironment()` rather than `process.env` (there is a test for that).
- **Registry and ClawHub trust model:** commands built from validated names and exact versions, re-fetched in main at install, hash-pinned skills rechecked at run time, registry tools always needing approval. This is careful work; do not loosen it.
- **Model and tool output is never executed or rendered as HTML.** No `dangerouslySetInnerHTML`, approval input is shown in a `<pre>`, tool input is schema-validated before approval is even asked, and tool names are matched against the connected list.
- **The run engine's structure:** provider-neutral `ModelSession`, limits checked before every call, cancellation through one `AbortSignal` that reaches model calls, tools and approvals. Stop works cleanly.
- **`runState.ts` as a pure reducer,** and the `bridge.ts` browser preview.
- **Logs** are capped at 200 entries and the panel shows 100, so no virtualization is needed.
- **Geist fonts** load per Unicode range; only the Latin files are fetched.
- **The single 1.1 MB renderer chunk.** It loads from disk; code splitting would add complexity for a few milliseconds.
- **Typecheck setup.** 0.6 s without incremental builds; adding `tsc -b` would gain nothing.
- **The test suite's content.** Keep every test.
- **Gemini `store: true`** is a documented trade-off in the code (Google holds the conversation so thought signatures survive). Fine as long as it is a choice; worth one line in the README.
