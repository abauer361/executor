import type { AgentTemplate, CatalogPackage, PackageKind } from '../../../shared/types'

const MCP_REPO = 'https://github.com/modelcontextprotocol/servers'
const SKILLS_REPO = 'https://github.com/anthropics/skills'
const EXAMPLES = 'Executor examples'

const reviewer: AgentTemplate = {
  name: 'PR Review Daemon',
  description: 'Reviews diffs for correctness, risky changes and leaked secrets.',
  face: 3,
  models: ['claude-sonnet-5-5', 'claude-haiku-5-5'],
  prompt:
    'You review pull requests. Report only concrete defects, each with the file, the line and a failing scenario. Flag any secret that appears in a diff.',
  mcpServers: ['github', 'git'],
  skills: [],
  limiter: { mode: 'tokens', tokens: 100_000, dollars: 5 }
}

const testGenerator: AgentTemplate = {
  name: 'Test Generator',
  description: 'Writes tests for changed code and runs them until they pass.',
  face: 4,
  models: ['claude-sonnet-5-5'],
  prompt:
    'You write tests for the code that changed. Match the conventions of the existing test suite. Each test must fail if the behavior it covers breaks.',
  mcpServers: ['filesystem', 'git'],
  skills: ['webapp-testing'],
  limiter: { mode: 'tokens', tokens: 100_000, dollars: 5 }
}

const docsWriter: AgentTemplate = {
  name: 'Docs Writer',
  description: 'Keeps READMEs and guides in step with the code.',
  face: 1,
  models: ['claude-haiku-5-5', 'gemini-2-0-flash'],
  prompt:
    'You update documentation to match the code. Prefer short, direct prose and working examples. Never document behavior you have not confirmed in the source.',
  mcpServers: ['filesystem', 'git'],
  skills: [],
  limiter: { mode: 'tokens', tokens: 50_000, dollars: 2 }
}

const researcher: AgentTemplate = {
  name: 'Research Analyst',
  description: 'Collects sources on a question and reports what they support.',
  face: 0,
  models: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  prompt:
    'You research a question across multiple sources. Cite each claim, separate what sources state from what you infer, and report disagreements between them.',
  mcpServers: ['fetch', 'memory'],
  skills: [],
  limiter: { mode: 'dollars', tokens: 250_000, dollars: 10 }
}

const factChecker: AgentTemplate = {
  name: 'Fact Checker',
  description: 'Verifies each cited claim against its source.',
  face: 2,
  models: ['claude-sonnet-5-5'],
  prompt:
    'You check claims against the sources they cite. Mark each claim as supported, unsupported or contradicted, and quote the passage that decides it.',
  mcpServers: ['fetch'],
  skills: [],
  limiter: { mode: 'tokens', tokens: 100_000, dollars: 5 }
}

export const CATALOG: CatalogPackage[] = [
  {
    id: 'filesystem',
    kind: 'mcp',
    name: 'Filesystem',
    author: 'modelcontextprotocol',
    summary: 'Read, write and search local files inside the directories you allow.',
    tags: ['files', 'local'],
    repo: MCP_REPO,
    transport: 'stdio',
    install: 'npx -y @modelcontextprotocol/server-filesystem <path>'
  },
  {
    id: 'github',
    kind: 'mcp',
    name: 'GitHub',
    author: 'github',
    summary: 'Work with repositories, issues, pull requests and Actions through the GitHub API.',
    tags: ['github', 'code', 'ci'],
    repo: 'https://github.com/github/github-mcp-server',
    transport: 'stdio',
    install: 'docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server'
  },
  {
    id: 'git',
    kind: 'mcp',
    name: 'Git',
    author: 'modelcontextprotocol',
    summary: 'Read, search and change local Git repositories.',
    tags: ['git', 'local'],
    repo: MCP_REPO,
    transport: 'stdio',
    install: 'uvx mcp-server-git'
  },
  {
    id: 'fetch',
    kind: 'mcp',
    name: 'Fetch',
    author: 'modelcontextprotocol',
    summary: 'Fetch web pages and convert them to Markdown for agents to read.',
    tags: ['web'],
    repo: MCP_REPO,
    transport: 'stdio',
    install: 'uvx mcp-server-fetch'
  },
  {
    id: 'memory',
    kind: 'mcp',
    name: 'Memory',
    author: 'modelcontextprotocol',
    summary: 'Persistent memory for agents, stored as a local knowledge graph.',
    tags: ['memory'],
    repo: MCP_REPO,
    transport: 'stdio',
    install: 'npx -y @modelcontextprotocol/server-memory'
  },
  {
    id: 'sequential-thinking',
    kind: 'mcp',
    name: 'Sequential Thinking',
    author: 'modelcontextprotocol',
    summary: 'Structured, step-by-step problem solving that can revise earlier steps.',
    tags: ['reasoning'],
    repo: MCP_REPO,
    transport: 'stdio',
    install: 'npx -y @modelcontextprotocol/server-sequential-thinking'
  },
  {
    id: 'time',
    kind: 'mcp',
    name: 'Time',
    author: 'modelcontextprotocol',
    summary: 'Current time and timezone conversion.',
    tags: ['utility'],
    repo: MCP_REPO,
    transport: 'stdio',
    install: 'uvx mcp-server-time'
  },
  {
    id: 'playwright',
    kind: 'mcp',
    name: 'Playwright',
    author: 'microsoft',
    summary: 'Drive a real browser through page structure instead of screenshots.',
    tags: ['browser', 'testing'],
    repo: 'https://github.com/microsoft/playwright-mcp',
    transport: 'stdio',
    install: 'npx @playwright/mcp@latest'
  },
  {
    id: 'mcp-builder',
    kind: 'skill',
    name: 'MCP Builder',
    author: 'anthropics',
    summary: 'Guides an agent through designing and building a new MCP server.',
    tags: ['mcp', 'development'],
    repo: SKILLS_REPO
  },
  {
    id: 'skill-creator',
    kind: 'skill',
    name: 'Skill Creator',
    author: 'anthropics',
    summary: 'Guides an agent through writing and improving agent skills.',
    tags: ['skills', 'authoring'],
    repo: SKILLS_REPO
  },
  {
    id: 'webapp-testing',
    kind: 'skill',
    name: 'Webapp Testing',
    author: 'anthropics',
    summary: 'Test local web applications with Playwright and capture what happened.',
    tags: ['testing', 'browser'],
    repo: SKILLS_REPO
  },
  {
    id: 'frontend-design',
    kind: 'skill',
    name: 'Frontend Design',
    author: 'anthropics',
    summary: 'Guidance for building distinctive, production-grade interfaces.',
    tags: ['ui', 'design'],
    repo: SKILLS_REPO
  },
  {
    id: 'pr-review-daemon',
    kind: 'agent',
    name: reviewer.name,
    author: EXAMPLES,
    summary: reviewer.description,
    tags: ['code-review', 'security'],
    agent: reviewer
  },
  {
    id: 'test-generator',
    kind: 'agent',
    name: testGenerator.name,
    author: EXAMPLES,
    summary: testGenerator.description,
    tags: ['testing'],
    agent: testGenerator
  },
  {
    id: 'docs-writer',
    kind: 'agent',
    name: docsWriter.name,
    author: EXAMPLES,
    summary: docsWriter.description,
    tags: ['docs'],
    agent: docsWriter
  },
  {
    id: 'research-analyst',
    kind: 'agent',
    name: researcher.name,
    author: EXAMPLES,
    summary: researcher.description,
    tags: ['research'],
    agent: researcher
  },
  {
    id: 'deep-research-swarm',
    kind: 'workflow',
    name: 'Deep Research Swarm',
    author: EXAMPLES,
    summary: 'Parallel researchers feed a fact checker, then a writer produces the report.',
    tags: ['research', 'parallel'],
    workflow: {
      name: 'deep-research-swarm',
      agents: [researcher, { ...researcher, name: 'Source Analyst', face: 4 }, factChecker, docsWriter],
      edges: [
        [0, 2],
        [1, 2],
        [2, 3]
      ]
    }
  },
  {
    id: 'code-review-gate',
    kind: 'workflow',
    name: 'Code Review Gate',
    author: EXAMPLES,
    summary: 'New tests and a code review both run before a change can move on.',
    tags: ['code-review', 'testing'],
    workflow: {
      name: 'review-gate',
      agents: [testGenerator, reviewer],
      edges: [[0, 1]]
    }
  }
]

export const PREINSTALLED = ['filesystem', 'github', 'git', 'webapp-testing', 'mcp-builder']

export const KIND_LABEL: Record<PackageKind, string> = {
  mcp: 'MCP Server',
  skill: 'Skill',
  agent: 'Agent',
  workflow: 'Workflow'
}

export const packageById = (id: string) => CATALOG.find((pkg) => pkg.id === id)
