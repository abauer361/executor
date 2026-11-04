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

1. Open Settings from the gear icon and paste an API key for each provider you want to use: Anthropic, OpenAI or Google. Runs are billed to your account with that provider, and a run only needs keys for the models it uses.
2. Download MCP servers from the Agent Marketplace, then finish any setup in Settings, such as choosing the folders agents may access.
3. Attach servers, skills and memory docs to an agent in Agent Builder.
4. Press Run, describe the goal and start the run.

Agents run in connection order, up to three at a time. Each agent receives the goal and the output of the agents connected into it. An agent with several incoming connections waits for all of them. If an agent stops early, the agents that depend on it are skipped.

### Limits

Before every model call, the app counts the input tokens for free and caps the reply to what remains of that agent's limit. If too little remains for a useful reply, the agent halts without spending anything. Limits cover the whole agent, so every step of a tool loop counts, including cached input. An agent also stops after 25 steps.

Gemini's token counter takes plain text only, so tool definitions and images are estimated in its count. Its limits can be off by a small amount until the first reply reports real usage.

### Choosing a model

An agent runs on the model picked in the Inspector, from any provider. Each agent in a workflow can use a different one. With two or more Claude models in its pool, you can pick **Auto**: a quick Haiku call chooses the cheapest Claude model in the pool that fits the work. It happens once per agent, because switching partway would lose the agent's cache and thinking. The call counts toward the agent's limit, and the reason appears in the logs.

### The MCP Registry

The MCP Registry tab in the Marketplace searches the public [MCP Registry](https://registry.modelcontextprotocol.io). Anyone can publish there and nobody reviews it, so:

- Commands are built by the app from a validated package name and an exact version. Free-form launch fields from the registry are never used.
- The entry is fetched again by the main process at install time, so the interface cannot change what runs.
- Installing needs a confirmation that shows exactly what will run. npm and PyPI packages start on your Mac as soon as you continue, and approvals only cover what agents do with them afterward.
- Remote servers are preferred when an entry offers both, because no code runs on your Mac. Anything an agent sends to their tools goes to that address.
- Registry servers cannot claim to be safe: every tool they offer asks for approval.

Docker packages, servers needing custom arguments or address values, and sign-in with OAuth are not supported yet. Those entries explain why they cannot be installed.

### Approvals

A tool runs without asking only if its server declares it read-only and it cannot reach outside this Mac. Everything else waits for you, including web requests and any tool with no declaration. The agent turns amber, and the Inspector shows exactly what it wants to do. You can allow it once, allow that tool for the rest of the run, or deny it. Stopping a run denies anything still waiting.

## Check it

```bash
npm test
npm run typecheck
```

## What is real and what is not yet

Real:

- Runs call Claude, GPT and Gemini through each provider's official SDK, in the main process.
- Agents use tools from real MCP servers. Servers start for each run and stop when it ends. Launch commands are defined in `src/shared/mcpServers.ts`, and the interface can only pass a server's id.
- Skills come from a reviewed list of first-party repositories in `src/shared/skills.ts`. Each one is locked to the commit it was reviewed at, and its text must match the recorded hash before an agent sees it. Skills and text memory docs are added to the agent's instructions.
- Token counts and costs come from reported usage at each provider's published rates, in `src/shared/pricing.ts`. Announced Gemini price changes apply on their dates. The live meter is an estimate until each model call finishes.
- Your API keys and MCP tokens are verified or tested, then encrypted with macOS keychain-backed storage. The interface can save or remove them but cannot read them back. Each API key is only sent to its own provider, whose address is fixed in the app, and MCP servers receive only their own settings.
- Projects, workflows, agents and settings are saved to `~/Library/Application Support/Executor/`.

Not yet:

- **DeepSeek is not connected.** It stays in the list, marked as not connected.
- **Routing covers Claude models only**, and picks one model per agent rather than per step.
- **Skills, prebuilt agents and workflows come from built-in lists** in `src/shared/skills.ts` and `src/renderer/src/data/catalog.ts`. Only MCP servers have a live registry.
- **Skills are instructions only.** Only `SKILL.md` is downloaded, so scripts and reference files bundled with a skill are not available. MCP Builder, Skill Creator and Webapp Testing bundle such files.
- **Memory docs must be text files** under 500 KB. Anything else is skipped and reported in the logs.
- **The starting projects and agents are sample data**, labelled in the ribbon until a workflow's first real run.

OpenAI requests are sent with storage turned off. Gemini conversations are stored by Google between steps, because that API keeps its thinking state on the server, so prompts and tool results stay with Google for 55 days on a paid project or 1 day on the free tier. Paid projects can shorten this in AI Studio.

MCP servers are third-party programs that run on your Mac when you download or use them, so install only ones you trust. Filesystem and Git need Node or `uv`, and GitHub needs Docker running.

Refused requests use Anthropic's server-side fallback on Opus and Sonnet. A fallback is billed as a second attempt, so in that rare case an agent can go slightly over its limit. Haiku has no fallback, so a refusal stops the agent.

The app is ad-hoc signed for use on this Mac. Sharing it with other people requires signing and notarizing it with an Apple Developer ID.

Set `EXECUTOR_API_URL` or `EXECUTOR_REGISTRY_URL` to point the app at a local mock for testing. The app ignores `ANTHROPIC_BASE_URL` so that the saved key cannot be redirected.
