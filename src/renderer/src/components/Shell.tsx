import { workflowStatus } from '../sim'
import { activeProject, activeWorkflow, useApp, type Page } from '../store'
import { Icon, Kbd, StatusDot } from './ui'

const NAV: { page: Page; label: string; icon: string; crumb: string }[] = [
  { page: 'canvas', label: 'Workflow Canvas', icon: 'hub', crumb: 'Workflow' },
  { page: 'builder', label: 'Agent Builder', icon: 'precision_manufacturing', crumb: 'Agent Builder' },
  { page: 'marketplace', label: 'Agent Marketplace', icon: 'extension', crumb: 'Agent Marketplace' }
]

export function Rail() {
  const page = useApp((state) => state.page)
  const project = useApp(activeProject)
  const status = useApp((state) => workflowStatus(activeWorkflow(state)))
  const { setPage, setUi } = useApp.getState()

  return (
    <aside className="rail">
      <div className="brand">
        <span className="brand-mark">E</span>
        <span className="brand-name">Executor</span>
      </div>

      <div className="rail-section">
        <button className="scope" type="button" onClick={() => setUi({ switcherOpen: true })}>
          <span className="scope-text">
            <span className="eyebrow">
              Project Scope <StatusDot status={status} />
            </span>
            <span className="scope-name">{project.name}</span>
          </span>
          <Kbd>⌘K</Kbd>
          <Icon name="unfold_more" />
        </button>
      </div>

      <div className="rail-label eyebrow">Workspace</div>
      <nav className="nav">
        {NAV.map((item) => (
          <button
            key={item.page}
            type="button"
            className={`nav-item ${page === item.page ? 'is-active' : ''}`}
            aria-current={page === item.page ? 'page' : undefined}
            onClick={() => setPage(item.page)}
          >
            <Icon name={item.icon} size={18} />
            <span>{item.label}</span>
            {item.page === 'canvas' && status === 'active' && <StatusDot status="active" />}
          </button>
        ))}
      </nav>
    </aside>
  )
}

export function Header() {
  const page = useApp((state) => state.page)
  const project = useApp(activeProject)
  const theme = useApp((state) => state.theme)
  const { setTheme, setUi } = useApp.getState()
  const crumb = NAV.find((item) => item.page === page)?.crumb

  return (
    <header className="header">
      <div className="crumbs">
        <button className="crumb-project" type="button" onClick={() => setUi({ switcherOpen: true })}>
          {project.name}
          <Icon name="expand_more" size={15} />
        </button>
        <span className="crumb-sep">/</span>
        <span className="crumb-page">{crumb}</span>
      </div>
      <button
        className="icon-button"
        type="button"
        aria-label="Toggle theme"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        <Icon name={theme === 'dark' ? 'dark_mode' : 'light_mode'} size={18} />
      </button>
    </header>
  )
}
