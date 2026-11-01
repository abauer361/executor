import { useState } from 'react'
import { RUNNABLE_MODELS } from '../../../../shared/pricing'
import { Icon, Kbd, RobotFace, StatusDot } from '../../components/ui'
import { modelName } from '../../data/models'
import { activeWorkflow, useApp, type BuilderSection } from '../../store'
import { budgetShare, formatDollars, formatTokens, runnableModel } from '../../usage'

const STATUS_NAME = { active: 'Active', queued: 'Queued', warning: 'Waiting', stopped: 'Stopped', idle: 'Idle' }

function EditRow({
  icon,
  label,
  count,
  onClick
}: {
  icon: string
  label: string
  count?: number
  onClick(): void
}) {
  return (
    <button className="edit-row" type="button" onClick={onClick}>
      <Icon name={icon} size={15} />
      <span className="grow">{label}</span>
      {count !== undefined && <span className="chip">{count}</span>}
      <Icon name="chevron_right" size={14} />
    </button>
  )
}

export function Inspector() {
  const open = useApp((state) => state.inspectorOpen)
  const workflow = useApp(activeWorkflow)
  const agents = useApp((state) => state.agents)
  const { setUi, openBuilder, inject, setNodeModel } = useApp.getState()
  const [instruction, setInstruction] = useState('')

  if (!open) return null

  const node = workflow.nodes.find((candidate) => candidate.selected)
  const agent = agents.find((candidate) => candidate.id === node?.data.agentId)

  const head = (
    <div className="inspector-head">
      <span className="strong">Inspector</span>
      <button
        className="icon-button"
        type="button"
        aria-label="Collapse Inspector"
        onClick={() => setUi({ inspectorOpen: false })}
      >
        <Icon name="keyboard_double_arrow_right" size={18} />
      </button>
    </div>
  )

  if (!node || !agent) {
    return (
      <aside className="inspector">
        {head}
        <p className="empty">Select an agent on the canvas to inspect it.</p>
      </aside>
    )
  }

  const { limiter } = agent
  const share = Math.round(budgetShare(agent, node.data) * 100)
  const activity = workflow.log.filter((entry) => entry.nodeId === node.id).slice(-30).reverse()
  const model = runnableModel(agent, node.data.activeModel) ?? node.data.activeModel
  const edit = (section: BuilderSection) => openBuilder(agent.id, section)
  const alreadyStarted = workflow.running && node.data.status !== 'queued'
  const canInject = instruction.trim().length > 0 && !alreadyStarted

  const send = () => {
    if (!canInject) return
    inject(node.id, instruction.trim())
    setInstruction('')
  }

  return (
    <aside className="inspector">
      {head}
      <div className="inspector-body">
        <section className="panel">
          <div className="row">
            <div className="tile">
              <RobotFace face={agent.face} size={20} />
            </div>
            <div className="stack grow">
              <span className="row">
                <span className="strong truncate grow">{agent.name}</span>
                <span className="mono row status-label">
                  <StatusDot status={node.data.status} />
                  {STATUS_NAME[node.data.status]}
                </span>
              </span>
              <span className="muted truncate">{node.data.task}</span>
            </div>
          </div>
          {agent.description && <p className="muted panel-text">{agent.description}</p>}
          <div className="panel-rule row">
            <span className="eyebrow grow">Active Model</span>
            <select
              className="select select-chip"
              aria-label="Active model"
              value={model}
              disabled={workflow.running}
              onChange={(event) => setNodeModel(node.id, event.target.value)}
            >
              {agent.models.map((id) => (
                <option key={id} value={id} disabled={!RUNNABLE_MODELS.includes(id)}>
                  {modelName(id)}
                </option>
              ))}
            </select>
          </div>
        </section>

        {node.data.output && (
          <section className="stack gap-6">
            <div className="row">
              <span className="eyebrow grow">Output</span>
              <button
                className="btn btn-ghost btn-mini"
                type="button"
                onClick={() => void navigator.clipboard.writeText(node.data.output ?? '')}
              >
                <Icon name="content_copy" size={14} />
                Copy
              </button>
            </div>
            <div className="output mono">{node.data.output}</div>
          </section>
        )}

        <section className="stack gap-6">
          <div className="row">
            <span className="eyebrow grow">{limiter.mode === 'tokens' ? 'Token Budget' : 'Dollar Budget'}</span>
            <span className="mono strong">{share}%</span>
          </div>
          <div className={`meter ${share >= 80 ? 'is-warning' : ''}`}>
            <span style={{ width: `${share}%` }} />
          </div>
          <div className="row mono muted">
            <span className="grow">
              {formatTokens(node.data.tokensUsed)} tokens used · {formatDollars(node.data.costUsed)}
            </span>
            <span>
              {limiter.mode === 'tokens'
                ? `${formatTokens(limiter.tokens)} limit`
                : `${formatDollars(limiter.dollars)} limit`}
            </span>
          </div>
        </section>

        <section className="stack gap-6">
          <span className="eyebrow">Configuration</span>
          <EditRow icon="code" label="Edit Prompt" onClick={() => edit('prompt')} />
          <EditRow icon="extension" label="Edit MCP Tools" count={agent.mcpServers.length} onClick={() => edit('mcp')} />
          <EditRow icon="bolt" label="Edit Skills" count={agent.skills.length} onClick={() => edit('skills')} />
          <EditRow icon="description" label="Edit Memory" count={agent.memory.length} onClick={() => edit('memory')} />
        </section>

        <section className="stack gap-6 inspector-rule">
          <div className="row">
            <span className="eyebrow grow">Inject Instruction</span>
            <Kbd>⌘↵ SEND</Kbd>
          </div>
          <textarea
            className="textarea"
            rows={2}
            value={instruction}
            placeholder={
              alreadyStarted ? 'This agent has already started.' : 'Add an instruction for when this agent starts...'
            }
            disabled={alreadyStarted}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send()
            }}
          />
          <button className="btn btn-primary inject" type="button" disabled={!canInject} onClick={send}>
            Inject
            <Icon name="arrow_forward" size={14} />
          </button>
        </section>

        <section className="stack gap-6">
          <span className="eyebrow">Activity</span>
          <div className="activity mono">
            {activity.map((entry) => (
              <div key={entry.id}>
                <span className="faint">{entry.time}</span> {entry.message}
              </div>
            ))}
            {activity.length === 0 && <div className="faint">No activity yet.</div>}
          </div>
        </section>
      </div>
    </aside>
  )
}
