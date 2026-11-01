# Executor

A desktop app for seeing how AI agents connect, what they are doing and what they cost.

- **Workflow Canvas:** organize work into projects and workflows, drag agents onto the canvas and connect them.
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

## Check it

```bash
npm test
npm run typecheck
```

## What is real and what is simulated

Real:

- Projects, workflows, agents and settings are saved to `~/Library/Application Support/Executor/state.json`.
- Downloads are written as JSON manifests to `~/Library/Application Support/Executor/library/<kind>/`. Each manifest records the package's source and install command.
- Memory docs are picked with the native file dialog. The app stores each file's path and size, not its contents.

Simulated or sample data:

- **Run does not call any model.** Usage is generated locally by `src/renderer/src/sim.ts`, and activity logs are placeholder events.
- **Dollar costs use one placeholder rate** of $0.02 per 1,000 tokens, `SAMPLE_RATE_PER_1K` in `sim.ts`.
- **The starting projects and agents are sample data** from `src/renderer/src/data/seed.ts`.
- **The Marketplace is a built-in list** in `src/renderer/src/data/catalog.ts`, not a live registry. A download saves the manifest. It does not install the server or fetch the skill's files.
- **The model list is a sample** in `src/renderer/src/data/models.ts`.
- **Multi-model routing is not implemented.** The Builder records a model pool, and the Inspector lets you choose which model is active.

The app is ad-hoc signed for use on this Mac. Sharing it with other people requires signing and notarizing it with an Apple Developer ID.
