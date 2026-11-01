import type { Agent, AgentStatus, LogEntry, Project, Workflow, WorkflowNode } from '../../../shared/types'
import { sampleCost } from '../usage'

const MINUTE = 60_000
const DEFAULT_MODELS = ['claude-sonnet-5-5', 'gpt-6.1-sol', 'gemini-3.8-flash']

const agent = (
  id: string,
  name: string,
  description: string,
  face: number,
  tokens: number,
  prompt: string,
  mcpServers: string[],
  skills: string[]
): Agent => ({
  id,
  name,
  description,
  face,
  prompt,
  mcpServers,
  skills,
  models: DEFAULT_MODELS,
  memory: [],
  limiter: { mode: 'tokens', tokens, dollars: 5 },
  source: 'mine'
})

function seedAgents(): Agent[] {
  return [
    agent(
      'lead-architect',
      'Lead Architect',
      'Breaks work into a system plan and assigns it to the other agents.',
      0,
      50_000,
      'You are the lead architect. Turn the request into a plan with clear interfaces, then assign each piece to the right agent.',
      ['github', 'filesystem'],
      ['mcp-builder']
    ),
    agent(
      'backend-api',
      'Backend API',
      'Implements server handlers and schema migrations.',
      1,
      200_000,
      'You build backend services. Keep schema changes backward compatible, and run the type check and tests before reporting work as done.',
      ['github', 'filesystem', 'git'],
      ['mcp-builder']
    ),
    agent(
      'frontend-eng',
      'Frontend Eng',
      'Builds interface components and client state.',
      2,
      100_000,
      'You build frontend features. Match the existing components, and confirm each change in the running app.',
      ['filesystem', 'git'],
      ['webapp-testing']
    ),
    agent(
      'code-reviewer',
      'Code Reviewer',
      'Reviews diffs before they move forward.',
      3,
      100_000,
      'You review diffs for defects. Report each finding with the file, the line and a failing scenario.',
      ['github', 'git'],
      []
    ),
    agent(
      'qa-e2e',
      'QA & E2E',
      'Runs end-to-end suites against each change.',
      4,
      100_000,
      'You run end-to-end tests against each change and report any failure with steps to reproduce it.',
      ['filesystem'],
      ['webapp-testing']
    ),
    {
      ...agent(
        'code-architect',
        'Code Architect',
        'Autonomous code reasoning, schema verification and migration design.',
        1,
        100_000,
        'You are Code Architect. Enforce structural correctness and schema invariants across repository workflows.\n1. Always inspect database schemas before issuing migration recommendations.\n2. Verify backwards-compatibility and idempotency for all SQL DDL changes.\n3. Format outputs with concrete, executable code blocks.',
        ['github', 'filesystem', 'git'],
        ['mcp-builder', 'webapp-testing']
      ),
      memory: [
        { id: 'doc-1', name: 'Architecture_Guide.md', path: '', size: 2_400_000 },
        { id: 'doc-2', name: 'db_schema.sql', path: '', size: 188_000 },
        { id: 'doc-3', name: 'api_spec.json', path: '', size: 540_000 }
      ]
    }
  ]
}

const node = (
  id: string,
  agentId: string,
  x: number,
  y: number,
  status: AgentStatus,
  task: string,
  tokensUsed: number
): WorkflowNode => ({
  id,
  type: 'agent',
  position: { x, y },
  data: { agentId, status, task, tokensUsed, costUsed: sampleCost(tokensUsed), activeModel: DEFAULT_MODELS[0] }
})

const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })

type ChainStep = [agentId: string, status: AgentStatus, task: string, tokensUsed: number]

function chain(id: string, steps: ChainStep[], lastRunAt: number | null, note?: string): Workflow {
  const nodes = steps.map(([agentId, status, task, tokensUsed], index) =>
    node(`${id}-${index}`, agentId, 32 + index * 232, 180, status, task, tokensUsed)
  )
  return {
    id,
    name: id,
    nodes,
    edges: nodes.slice(1).map((target, index) => edge(nodes[index].id, target.id)),
    running: false,
    lastRunAt,
    note,
    log: [],
    sample: nodes.length > 0
  }
}

const seedLog = (nodeId: string): LogEntry[] =>
  [
    'Reading issue specification',
    'Passed type check',
    'Generated migration',
    'All tests passing'
  ].map((message, index) => ({
    id: `seed-log-${index}`,
    time: '14:02',
    nodeId,
    agent: 'Backend API',
    message
  }))

function sweFleet(now: number): Workflow {
  return {
    id: 'swe-fleet',
    name: 'swe-fleet',
    nodes: [
      node('lead', 'lead-architect', 32, 180, 'active', 'System Plan', 18_400),
      node('backend', 'backend-api', 264, 180, 'active', 'Auth Migration', 124_000),
      node('frontend', 'frontend-eng', 496, 96, 'active', 'State Sync', 42_800),
      node('reviewer', 'code-reviewer', 496, 264, 'warning', 'Awaiting Diff', 81_200),
      node('qa', 'qa-e2e', 728, 180, 'active', 'Continuous Run', 23_600)
    ],
    edges: [
      edge('lead', 'backend'),
      edge('backend', 'frontend'),
      edge('backend', 'reviewer'),
      edge('frontend', 'qa'),
      edge('reviewer', 'qa')
    ],
    running: false,
    lastRunAt: now - 2 * MINUTE,
    log: seedLog('backend'),
    sample: true
  }
}

export function createSeed() {
  const now = Date.now()
  const workflowProject = (id: string, name: string, tag: string, workflows: Workflow[]): Project => ({
    id,
    name,
    tag,
    workflows,
    activeWorkflowId: workflows[0].id
  })

  const projects: Project[] = [
    workflowProject('core-monorepo', 'Core Monorepo', 'PR #1482', [
      sweFleet(now),
      chain(
        'auth-migration-pipeline',
        [
          ['lead-architect', 'active', 'Plan Rollout', 12_000],
          ['backend-api', 'active', 'Token Refresh', 30_000],
          ['code-reviewer', 'active', 'Review Queue', 8_000]
        ],
        now - 8 * MINUTE
      ),
      chain(
        'continuous-e2e',
        [
          ['frontend-eng', 'active', 'Build Preview', 6_000],
          ['backend-api', 'active', 'Seed Fixtures', 4_500],
          ['qa-e2e', 'active', 'Run Suite', 22_000],
          ['code-reviewer', 'active', 'Triage Failures', 3_000]
        ],
        now - 14 * MINUTE
      ),
      chain(
        'code-review-gate',
        [
          ['code-architect', 'idle', 'Diff Ready', 14_000],
          ['code-reviewer', 'warning', 'Awaiting Approval', 9_000]
        ],
        now - 31 * MINUTE,
        'Diff review'
      ),
      { ...chain('infra-provisioning', [], now - 1440 * MINUTE) },
      { ...chain('nightly-benchmarks', [], null), schedule: '02:00' }
    ]),
    workflowProject('payments', 'Payments & Billing Engine', 'main // v4.12.0', [
      chain(
        'fintech-sync',
        [
          ['lead-architect', 'active', 'Ledger Audit', 9_000],
          ['backend-api', 'active', 'Reconcile', 41_000],
          ['qa-e2e', 'active', 'Invoice Suite', 12_000]
        ],
        now - 5 * MINUTE
      )
    ]),
    workflowProject('design-sync', 'Autonomous Design System Sync', 'feature/tokens-v3', [
      chain(
        'ds-tokens',
        [
          ['frontend-eng', 'idle', 'Token Export', 21_000],
          ['code-reviewer', 'warning', 'Diff Review', 16_000]
        ],
        now - 22 * MINUTE,
        'Diff review'
      )
    ]),
    workflowProject('k8s-triage', 'K8s Cluster Auto-Triage', 'cluster-east-1', [
      chain(
        'sre-ops',
        [
          ['lead-architect', 'active', 'Alert Intake', 4_000],
          ['backend-api', 'active', 'Trace Logs', 18_000],
          ['code-architect', 'active', 'Root Cause', 27_000],
          ['qa-e2e', 'active', 'Verify Fix', 6_000]
        ],
        now - 3 * MINUTE
      )
    ])
  ]

  return { projects, agents: seedAgents(), activeProjectId: 'core-monorepo' }
}
