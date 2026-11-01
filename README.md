# Executor

A desktop app for seeing how AI agents connect, what they are doing and what they cost.

- **Workflow Canvas:** organize work into projects and workflows, drag agents onto the canvas, connect them and run them.
- **Agent Builder:** set an agent's prompt, models, limiter, MCP servers, skills and memory docs.
- **Agent Marketplace:** browse open-source MCP servers and skills, plus example agents and workflows, and download them for local use.

## Run it

Open `dist/mac-arm64/Executor.app`, or rebuild it first:

```bash
npm install
npm run package
```

For development:

```bash
npm run dev
```

## Run your agents

1. Open Settings from the gear icon and paste an Anthropic API key. Runs are billed to your Anthropic account.
2. Download MCP servers from the Agent Marketplace, then finish any setup in Settings, such as choosing the folders agents may access.
3. Attach servers, skills and memory docs to an agent in Agent Builder.
4. Press Run, describe the goal and start the run.

Agents run in connection order, up to three at a time. Each agent receives the goal and the output of the agents connected into it. An agent with several incoming connections waits for all of them. If an agent stops early, the agents that depend on it are skipped.

### Limits

Before every model call, the app counts the input tokens for free and caps the reply to what remains of that agent's limit. If too little remains for a useful reply, the agent halts without spending anything. Limits cover the whole agent, so every step of a tool loop counts, including cached input. An agent also stops after 25 steps.

### Approvals

A tool runs without asking only if its server declares it read-only and it cannot reach outside this Mac. Everything else waits for you, including web requests and any tool with no declaration. The agent turns amber, and the Inspector shows exactly what it wants to do. You can allow it once, allow that tool for the rest of the run, or deny it. Stopping a run denies anything still waiting.

## Check it

```bash
npm test
npm run typecheck
```

## What is real and what is not yet

Real:

- Runs call the Claude API through the official SDK, in the main process.
- Agents use tools from real MCP servers. Servers start for each run and stop when it ends. Launch commands are defined in `src/shared/mcpServers.ts`, and the interface can only pass a server's id.
- Skills are downloaded from `anthropics/skills`, and skills and text memory docs are added to the agent's instructions.
- Token counts and costs come from billed usage at Anthropic's published rates. The live meter is an estimate until each model call finishes.
- Your API key and MCP tokens are verified or tested, then encrypted with macOS keychain-backed storage. The interface can save or remove them but cannot read them back. The API key is only sent to `api.anthropic.com`, and MCP servers receive only their own settings.
- Projects, workflows, agents and settings are saved to `~/Library/Application Support/Executor/`.

Not yet:

- **Only Claude models run.** Other models stay in the pool but are marked as not connected.
- **Multi-model routing is not implemented.** A run uses the model picked in the Inspector, or the first Claude model in the pool.
- **The Marketplace is a built-in list** in `src/renderer/src/data/catalog.ts`, not a live registry.
- **Skills are instructions only.** Scripts bundled with a skill are not run.
- **Memory docs must be text files** under 500 KB. Anything else is skipped and reported in the logs.
- **The starting projects and agents are sample data**, labelled in the ribbon until a workflow's first real run.

MCP servers are third-party programs that run on your Mac when you download or use them, so install only ones you trust. Filesystem and Git need Node or `uv`, and GitHub needs Docker running.

Refused requests use Anthropic's server-side fallback on Opus and Sonnet. A fallback is billed as a second attempt, so in that rare case an agent can go slightly over its limit. Haiku has no fallback, so a refusal stops the agent.

The app is ad-hoc signed for use on this Mac. Sharing it with other people requires signing and notarizing it with an Apple Developer ID.

Set `EXECUTOR_API_URL` to point the app at a local mock API for testing. The app ignores `ANTHROPIC_BASE_URL` so that the saved key cannot be redirected.
