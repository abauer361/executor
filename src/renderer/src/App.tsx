import { useEffect } from 'react'
import { bridge } from './bridge'
import { Header, Rail } from './components/Shell'
import { ProjectSwitcher } from './components/ProjectSwitcher'
import { BuilderPage } from './pages/BuilderPage'
import { CanvasPage } from './pages/canvas/CanvasPage'
import { MarketplacePage } from './pages/MarketplacePage'
import { useApp } from './store'

export function App() {
  const hydrated = useApp((state) => state.hydrated)
  const page = useApp((state) => state.page)
  const theme = useApp((state) => state.theme)

  useEffect(() => {
    void useApp.getState().hydrate()
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const timer = setInterval(() => useApp.getState().tick(), 1000)
    return () => clearInterval(timer)
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

  if (!hydrated) return null

  return (
    <div className="app" data-platform={bridge.platform}>
      <Rail />
      <main className="main">
        <Header />
        {page === 'canvas' && <CanvasPage />}
        {page === 'builder' && <BuilderPage />}
        {page === 'marketplace' && <MarketplacePage />}
      </main>
      <ProjectSwitcher />
    </div>
  )
}
