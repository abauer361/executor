import { useReactFlow } from '@xyflow/react'
import { useState, type DragEvent } from 'react'
import type { Agent, Workflow } from '../../../../shared/types'
import { Icon, RobotFace, StatusBadge, StatusDot } from '../../components/ui'
import { CATALOG } from '../../data/catalog'
import { agentSummary, countOf, timeAgo, workflowStatus } from '../../sim'
import { activeProject, useApp } from '../../store'
import { AGENT_DRAG_TYPE, dropPosition } from './FlowCanvas'

function runLabel(workflow: Workflow) {
  if (workflow.note) return workflow.note
  if (workflow.schedule) return `Scheduled ${workflow.schedule}`
  if (workflow.running) return 'Running'
  if (workflow.lastRunAt === null) return 'Not run yet'
  return `Run ${timeAgo(workflow.lastRunAt)}`
}

function SearchField({ value, placeholder, onChange }: { value: string; placeholder: string; onChange(value: string): void }) {
  return (
    <div className="field-icon">
      <Icon name="search" />
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function WorkflowsTab() {
  const project = useApp(activeProject)
  const downloads = useApp((state) => state.downloads)
  const creating = useApp((state) => state.creatingWorkflow)
  const { selectWorkflow, addWorkflow, addTemplateToProject, setUi } = useApp.getState()
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')

  const visible = project.workflows.filter((workflow) => workflow.name.toLowerCase().includes(query.toLowerCase()))
  const templates = CATALOG.filter((pkg) => pkg.kind === 'workflow' && downloads[pkg.id])

  const create = () => {
    if (!name.trim()) return
    addWorkflow(name.trim())
    setName('')
  }

  return (
    <>
      <div className="drawer-pad">
        <SearchField value={query} placeholder="Search workflows..." onChange={setQuery} />
      </div>
      <div className="drawer-pad drawer-rule">
        {creating ? (
          <input
            autoFocus
            className="input"
            value={name}
            placeholder="Workflow name, then Return"
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setUi({ creatingWorkflow: false })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create()
              if (event.key === 'Escape') setUi({ creatingWorkflow: false })
            }}
          />
        ) : (
          <button className="btn btn-secondary btn-block" type="button" onClick={() => setUi({ creatingWorkflow: true })}>
            <Icon name="add" />
            Create Custom Workflow
          </button>
        )}
      </div>

      <div className="drawer-scroll">
        <div className="section-label">
          <span className="eyebrow">Workflows</span>
          <span className="chip">{project.workflows.length} Total</span>
        </div>
        <div className="list">
          {visible.map((workflow) => {
            const status = workflowStatus(workflow)
            return (
              <button
                key={workflow.id}
                type="button"
                className={`list-card ${workflow.id === project.activeWorkflowId ? 'is-active' : ''}`}
                onClick={() => selectWorkflow(workflow.id)}
              >
                <span className="row">
                  <StatusDot status={status} />
                  <span className="list-title truncate">{workflow.name}</span>
                  <StatusBadge status={status} />
                </span>
                <span className="list-meta mono">
                  <span>{countOf(workflow.nodes.length, 'agent')}</span>
                  <span className={workflow.note ? 'warning-text' : ''}>{runLabel(workflow)}</span>
                </span>
              </button>
            )
          })}
          {visible.length === 0 && <p className="empty">No workflows match that search.</p>}
        </div>

        {templates.length > 0 && (
          <>
            <div className="section-label">
              <span className="eyebrow">Downloaded</span>
              <span className="chip">{templates.length}</span>
            </div>
            <div className="list">
              {templates.map((pkg) => (
                <div key={pkg.id} className="list-card is-static">
                  <span className="row">
                    <span className="list-title truncate grow">{pkg.name}</span>
                    <button className="btn btn-ghost btn-mini" type="button" onClick={() => addTemplateToProject(pkg)}>
                      <Icon name="add" size={14} />
                      Add
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}

function AgentRow({ agent, onAdd }: { agent: Agent; onAdd(agent: Agent): void }) {
  const onDragStart = (event: DragEvent) => {
    event.dataTransfer.setData(AGENT_DRAG_TYPE, agent.id)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      className="agent-row"
      draggable
      role="button"
      tabIndex={0}
      title="Drag onto the canvas, or double-click to add"
      onDragStart={onDragStart}
      onDoubleClick={() => onAdd(agent)}
      onKeyDown={(event) => event.key === 'Enter' && onAdd(agent)}
    >
      <span className="faint">
        <Icon name="drag_indicator" />
      </span>
      <span className="agent-row-face">
        <RobotFace face={agent.face} size={18} />
      </span>
      <span className="stack grow">
        <span className="list-title truncate">{agent.name}</span>
        <span className="agent-row-meta truncate">{agentSummary(agent)}</span>
      </span>
    </div>
  )
}

function AgentsTab() {
  const agents = useApp((state) => state.agents)
  const { addAgentNode, createAgent, setPage } = useApp.getState()
  const { screenToFlowPosition } = useReactFlow()
  const [query, setQuery] = useState('')

  const matches = agents.filter((agent) => agent.name.toLowerCase().includes(query.toLowerCase()))
  const mine = matches.filter((agent) => agent.source === 'mine')
  const downloaded = matches.filter((agent) => agent.source === 'downloaded')

  const addToCenter = (agent: Agent) => {
    const viewport = document.querySelector('.viewport')?.getBoundingClientRect()
    if (!viewport) return
    const center = { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 }
    addAgentNode(agent.id, dropPosition(screenToFlowPosition(center)))
  }

  return (
    <>
      <div className="drawer-pad">
        <SearchField value={query} placeholder="Search agents..." onChange={setQuery} />
      </div>
      <div className="drawer-scroll">
        <div className="section-label">
          <span className="eyebrow">My Agents</span>
          <span className="chip">{mine.length}</span>
        </div>
        <div className="list">
          {mine.map((agent) => (
            <AgentRow key={agent.id} agent={agent} onAdd={addToCenter} />
          ))}
        </div>

        <div className="section-label">
          <span className="eyebrow">Downloaded</span>
          <span className="chip">{downloaded.length}</span>
        </div>
        <div className="list">
          {downloaded.map((agent) => (
            <AgentRow key={agent.id} agent={agent} onAdd={addToCenter} />
          ))}
          {downloaded.length === 0 && (
            <p className="empty">
              Agents you download from the{' '}
              <button className="link" type="button" onClick={() => setPage('marketplace')}>
                Marketplace
              </button>{' '}
              appear here.
            </p>
          )}
        </div>
      </div>
      <div className="drawer-foot">
        <button className="btn btn-secondary btn-block" type="button" onClick={createAgent}>
          <Icon name="add" />
          Build New Agent
        </button>
      </div>
    </>
  )
}

export function Drawer() {
  const open = useApp((state) => state.drawerOpen)
  const tab = useApp((state) => state.drawerTab)
  const { setUi } = useApp.getState()

  if (!open) return null

  return (
    <aside className="drawer">
      <div className="tabs">
        <div className="tab-list" role="tablist">
          {(['workflows', 'agents'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className={`tab ${tab === name ? 'is-active' : ''}`}
              onClick={() => setUi({ drawerTab: name })}
            >
              {name === 'workflows' ? 'Workflows' : 'Agents'}
            </button>
          ))}
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Collapse drawer"
          onClick={() => setUi({ drawerOpen: false })}
        >
          <Icon name="keyboard_double_arrow_left" size={18} />
        </button>
      </div>
      {tab === 'workflows' ? <WorkflowsTab /> : <AgentsTab />}
    </aside>
  )
}
