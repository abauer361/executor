import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@xyflow/react/dist/base.css'
import 'material-symbols/outlined.css'
import './styles.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
