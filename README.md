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
2. Press Run, describe the goal and start the run.

Agents run in connection order, up to three at a time. Each agent receives the goal and the output of the agents connected into it. An agent with several incoming connections waits for all of them. If an agent stops early, the agents that depend on it are skipped.

Before each model call, the app counts the input tokens for free and caps the reply to what remains of that agent's limit. If too little remains for a useful reply, the agent halts without spending anything.

## Check it

```bash
npm test
npm run typecheck
```

## What is real and what is not yet

Real:

- Runs call the Claude API through the official SDK, in the main process.
- Token counts and costs come from billed usage at Anthropic's published rates. The live meter during a run is an estimate until each agent finishes.
- Your API key is verified, then encrypted with macOS keychain-backed storage in `anthropic-key.enc`. The interface can save or remove it but cannot read it back, and it is only sent to `api.anthropic.com`.
- Projects, workflows, agents and settings are saved to `~/Library/Application Support/Executor/state.json`.
- Downloads are written as JSON manifests to `~/Library/Application Support/Executor/library/<kind>/`.

Not yet:

- **Agents have no tools.** MCP servers, skills and memory docs can be attached but are not used in runs. Each agent makes one model call, and agents are told they cannot read files, run commands or browse.
- **Only Claude models run.** Other models stay in the pool but are marked as not connected.
- **Multi-model routing is not implemented.** A run uses the model picked in the Inspector, or the first Claude model in the pool.
- **The Marketplace is a built-in list** in `src/renderer/src/data/catalog.ts`, not a live registry. A download saves the manifest. It does not install the server or fetch the skill's files.
- **The starting projects and agents are sample data**, labelled in the ribbon until a workflow's first real run.

Refused requests use Anthropic's server-side fallback on Opus and Sonnet. A fallback is billed as a second attempt, so in that rare case an agent can go slightly over its limit. Haiku has no fallback, so a refusal stops the agent.

The app is ad-hoc signed for use on this Mac. Sharing it with other people requires signing and notarizing it with an Apple Developer ID.

Set `EXECUTOR_API_URL` to point the app at a local mock API for testing. The app ignores `ANTHROPIC_BASE_URL` so that the saved key cannot be redirected.
