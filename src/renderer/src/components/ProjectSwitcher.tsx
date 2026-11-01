import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Project } from '../../../shared/types'
import { useApp } from '../store'
import { countOf, workflowStatus } from '../usage'
import { Icon, Kbd, StatusDot } from './ui'

function projectStatus(project: Project) {
  const statuses = project.workflows.map(workflowStatus)
  if (statuses.includes('active')) return 'active'
  return statuses.includes('warning') ? 'warning' : 'stopped'
}

export function ProjectSwitcher() {
  const open = useApp((state) => state.switcherOpen)
  if (!open) return null
  return <SwitcherDialog />
}

function SwitcherDialog() {
  const projects = useApp((state) => state.projects)
  const activeId = useApp((state) => state.activeProjectId)
  const { selectProject, addProject, setUi } = useApp.getState()

  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const close = () => setUi({ switcherOpen: false })

  useEffect(() => searchRef.current?.focus(), [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return projects
    return projects.filter((project) =>
      [project.name, project.tag, ...project.workflows.map((workflow) => workflow.name)]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [projects, query])

  const onSearchKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((value) => Math.min(value + 1, visible.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((value) => Math.max(value - 1, 0))
    } else if (event.key === 'Enter' && visible[cursor]) {
      selectProject(visible[cursor].id)
    }
  }

  const create = () => {
    if (name.trim()) addProject(name.trim())
  }

  return (
    <div
      className="backdrop"
      onMouseDown={close}
      onKeyDown={(event) => event.key === 'Escape' && close()}
      role="presentation"
    >
      <div className="dialog" role="dialog" aria-label="Projects" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <div className="tile">
            <Icon name="hub" size={18} />
          </div>
          <div className="stack">
            <span className="strong">Projects</span>
            <span className="eyebrow">{projects.length} projects</span>
          </div>
          <Kbd>ESC</Kbd>
        </div>

        <div className="dialog-search">
          <div className="field-icon">
            <Icon name="search" />
            <input
              ref={searchRef}
              className="input"
              value={query}
              placeholder="Search projects and workflows..."
              onChange={(event) => {
                setQuery(event.target.value)
                setCursor(0)
              }}
              onKeyDown={onSearchKey}
            />
          </div>
        </div>

        <div className="dialog-list">
          {visible.map((project, index) => {
            const agents = project.workflows.reduce((sum, workflow) => sum + workflow.nodes.length, 0)
            return (
              <button
                key={project.id}
                type="button"
                className={`project-card ${index === cursor ? 'is-cursor' : ''} ${
                  project.id === activeId ? 'is-current' : ''
                }`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => selectProject(project.id)}
              >
                <span className="stack grow">
                  <span className="row">
                    <span className="strong">{project.name}</span>
                    <StatusDot status={projectStatus(project)} />
                    {project.id === activeId && <span className="chip">Current</span>}
                  </span>
                  <span className="mono faint">
                    {project.tag} · {countOf(project.workflows.length, 'workflow')} · {countOf(agents, 'agent')}
                  </span>
                </span>
                <Icon name="arrow_forward" />
              </button>
            )
          })}
          {visible.length === 0 && <p className="empty">No projects match that search.</p>}
        </div>

        <div className="dialog-foot">
          {creating ? (
            <div className="row grow">
              <input
                autoFocus
                className="input"
                value={name}
                placeholder="Project name"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && create()}
              />
              <button className="btn btn-primary" type="button" disabled={!name.trim()} onClick={create}>
                Create
              </button>
            </div>
          ) : (
            <>
              <button className="btn btn-primary" type="button" onClick={() => setCreating(true)}>
                <Icon name="add" />
                New Project
              </button>
              <span className="hints mono faint">
                <Kbd>↑↓</Kbd> Navigate <Kbd>↵</Kbd> Select
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
