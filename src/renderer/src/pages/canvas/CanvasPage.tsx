import { ReactFlowProvider, useReactFlow, useViewport } from '@xyflow/react'
import { Icon, StatusDot } from '../../components/ui'
import { activeProject, activeWorkflow, useApp } from '../../store'
import { formatDollars, formatTokens, totalCost, totalTokens, workflowStatus } from '../../usage'
import { Drawer } from './Drawer'
import { FIT_OPTIONS, FlowCanvas } from './FlowCanvas'
import { Inspector } from './Inspector'
import { RunControl } from './RunControl'

const STATUS_LABEL = {
  active: 'Active Execution',
  warning: 'Needs Review',
  stopped: 'Stopped',
  completed: 'Completed'
}

function Ribbon() {
  const workflow = useApp(activeWorkflow)
  const logsOpen = useApp((state) => state.logsOpen)
  const { autoLayout, setUi } = useApp.getState()
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()

  const status = workflowStatus(workflow)

  const layout = () => {
    autoLayout()
    requestAnimationFrame(() => void fitView({ ...FIT_OPTIONS, duration: 200 }))
  }

  return (
    <div className="ribbon">
      <div className="row">
        <StatusDot status={status} />
        <span className="strong">{workflow.name}</span>
        <span className="faint">•</span>
        <span className="muted">{STATUS_LABEL[status]}</span>
        <span className="ribbon-divider" />
        <span className="mono muted">
          {formatTokens(totalTokens(workflow))} tokens · {formatDollars(totalCost(workflow))} this run
        </span>
        {workflow.sample && <span className="chip">Sample data</span>}
      </div>

      <div className="row">
        <div className="zoom">
          <button type="button" aria-label="Zoom out" onClick={() => void zoomOut({ duration: 120 })}>
            <Icon name="remove" size={15} />
          </button>
          <span className="mono">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => void zoomIn({ duration: 120 })}>
            <Icon name="add" size={15} />
          </button>
          <button type="button" aria-label="Fit to view" onClick={() => void fitView({ ...FIT_OPTIONS, duration: 200 })}>
            <Icon name="crop_free" size={15} />
          </button>
        </div>
        <button className="btn btn-secondary" type="button" onClick={layout}>
          <Icon name="account_tree" size={15} />
          Layout
        </button>
        <button
          className={`btn btn-secondary ${logsOpen ? 'is-on' : ''}`}
          type="button"
          onClick={() => setUi({ logsOpen: !logsOpen })}
        >
          <Icon name="terminal" size={15} />
          Logs
        </button>
        <span className="ribbon-divider" />
        <RunControl />
      </div>
    </div>
  )
}

function LogsPanel() {
  const log = useApp((state) => activeWorkflow(state).log)
  const entries = log.slice(-100).reverse()

  return (
    <section className="logs" aria-label="Logs">
      <div className="logs-head eyebrow">Logs</div>
      <div className="logs-body mono">
        {entries.map((entry) => (
          <div key={entry.id} className="log-line">
            <span className="faint">{entry.time}</span>
            <span className="log-agent">{entry.agent}</span>
            <span className="muted">{entry.message}</span>
          </div>
        ))}
        {entries.length === 0 && <div className="faint">No activity yet. Press Run to start.</div>}
      </div>
    </section>
  )
}

export function CanvasPage() {
  const workflowId = useApp((state) => activeProject(state).activeWorkflowId)
  const logsOpen = useApp((state) => state.logsOpen)

  return (
    <ReactFlowProvider key={workflowId}>
      <Ribbon />
      <div className="workbench">
        <Drawer />
        <div className="canvas-column">
          <FlowCanvas />
          {logsOpen && <LogsPanel />}
        </div>
        <Inspector />
      </div>
    </ReactFlowProvider>
  )
}
