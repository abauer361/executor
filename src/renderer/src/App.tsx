import { useEffect } from 'react'
import type { RunEvent } from '../../shared/types'
import { createBatcher } from './batcher'
import { bridge } from './bridge'
import { Header, Rail } from './components/Shell'
import { ProjectSwitcher } from './components/ProjectSwitcher'
import { SettingsDialog } from './components/SettingsDialog'
import { BuilderPage } from './pages/BuilderPage'
import { CanvasPage } from './pages/canvas/CanvasPage'
import { MarketplacePage } from './pages/MarketplacePage'
import { useApp } from './store'

export function App() {
  const hydrated = useApp((state) => state.hydrated)
  const page = useApp((state) => state.page)
  const theme = useApp((state) => state.theme)
  const notice = useApp((state) => state.notice)
  const loadError = useApp((state) => state.loadError)

  useEffect(() => {
    void useApp.getState().hydrate()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const batch = createBatcher<RunEvent>((events) => useApp.getState().applyRunEvents(events))
    const unsubscribe = bridge.onRunEvent(batch.add)
    return () => {
      unsubscribe()
      batch.flush()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return
      const { setUi, setPage, switcherOpen } = useApp.getState()
      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        setUi({ switcherOpen: !switcherOpen })
      } else if (key === 'n') {
        event.preventDefault()
        setPage('canvas')
        setUi({ drawerOpen: true, drawerTab: 'workflows', creatingWorkflow: true })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (loadError) {
    return (
      <div className="load-error" role="alert">
        <span className="strong">Executor could not load your workspace</span>
        <p className="mono muted">{loadError}</p>
        <button className="btn btn-primary" type="button" onClick={() => void useApp.getState().hydrate()}>
          Try Again
        </button>
      </div>
    )
  }
  if (!hydrated) return null

  return (
    <div className="app" data-platform={bridge.platform}>
      <Rail />
      <main className="main">
        <Header />
        {notice && (
          <div className="notice" role="alert">
            <span className="grow">{notice}</span>
            <button className="btn btn-ghost btn-mini" type="button" onClick={() => useApp.getState().dismissNotice()}>
              Dismiss
            </button>
          </div>
        )}
        {page === 'canvas' && <CanvasPage />}
        {page === 'builder' && <BuilderPage />}
        {page === 'marketplace' && <MarketplacePage />}
      </main>
      <ProjectSwitcher />
      <SettingsDialog />
    </div>
  )
}
