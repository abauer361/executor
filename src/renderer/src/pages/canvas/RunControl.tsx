import { useState } from 'react'
import { Icon, Kbd } from '../../components/ui'
import { packageById } from '../../data/catalog'
import { runProblems, runSpendCeiling, runWarnings } from '../../runState'
import { activeWorkflow, openRouterIds, useApp } from '../../store'
import { countOf, formatDollars } from '../../usage'

function RunPanel() {
  const workflow = useApp(activeWorkflow)
  const agents = useApp((state) => state.agents)
  const apiKeys = useApp((state) => state.apiKeys)
  const listed = useApp(openRouterIds)
  const downloads = useApp((state) => state.downloads)
  const mcpSetups = useApp((state) => state.mcpSetups)
  const registry = useApp((state) => state.registryServers)
  const clawhub = useApp((state) => state.clawhubSkills)
  const { beginRun, setUi } = useApp.getState()
  const [goal, setGoal] = useState(workflow.goal ?? '')

  if (!Object.values(apiKeys).some(Boolean)) {
    return (
      <div className="run-panel" role="dialog" aria-label="Add an API key">
        <span className="eyebrow">API key needed</span>
        <p className="muted">Add an API key so agents can run. Runs are billed to your account with that provider.</p>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => setUi({ runPanelOpen: false, settingsOpen: true })}
        >
          Open Settings
        </button>
      </div>
    )
  }

  const problems = runProblems(workflow, agents, apiKeys, listed)
  const canStart = goal.trim().length > 0 && problems.length === 0
  const unavailable = runWarnings(workflow, agents, downloads, mcpSetups, registry).map(
    (id) => packageById(id, registry, clawhub)?.name ?? id
  )

  return (
    <div className="run-panel" role="dialog" aria-label="Start a run">
      <span className="eyebrow">Goal</span>
      <textarea
        autoFocus
        className="textarea"
        rows={3}
        value={goal}
        placeholder="What should these agents work on?"
        aria-label="Run goal"
        onChange={(event) => setGoal(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.metaKey && canStart) beginRun(goal.trim())
        }}
      />
      {problems.map((problem) => (
        <p key={problem} className="mono warning-text">
          {problem}
        </p>
      ))}
      {unavailable.length > 0 && (
        <p className="mono muted">
          Not available to agents yet: {unavailable.join(', ')}.{' '}
          <button
            className="link"
            type="button"
            onClick={() => setUi({ runPanelOpen: false, settingsOpen: true })}
          >
            Set up
          </button>
        </p>
      )}
      <div className="row">
        <span className="mono muted grow">
          {countOf(workflow.nodes.length, 'agent')} · limits cap it at {formatDollars(runSpendCeiling(workflow, agents, listed))}
        </span>
        <Kbd>⌘↵</Kbd>
      </div>
      <button className="btn btn-primary btn-block" type="button" disabled={!canStart} onClick={() => beginRun(goal.trim())}>
        <Icon name="play_arrow" />
        Start Run
      </button>
    </div>
  )
}

export function RunControl() {
  const workflow = useApp(activeWorkflow)
  const open = useApp((state) => state.runPanelOpen)
  const { setUi, stopRun } = useApp.getState()

  if (workflow.running) {
    return (
      <button className="btn btn-primary" type="button" onClick={stopRun}>
        <Icon name="stop" />
        Stop
      </button>
    )
  }

  return (
    <div
      className="run-control"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setUi({ runPanelOpen: false })
      }}
      onKeyDown={(event) => event.key === 'Escape' && setUi({ runPanelOpen: false })}
    >
      <button
        className="btn btn-primary"
        type="button"
        disabled={workflow.nodes.length === 0}
        aria-expanded={open}
        onClick={() => setUi({ runPanelOpen: !open })}
      >
        <Icon name="play_arrow" />
        Run
      </button>
      {open && <RunPanel />}
    </div>
  )
}
