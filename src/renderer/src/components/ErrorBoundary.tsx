import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  message: string | null
}

// Without this, any error while drawing leaves an empty window with no way forward.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { message: null }

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Executor could not draw this screen', error, info.componentStack)
  }

  render() {
    if (this.state.message === null) return this.props.children
    return (
      <div className="load-error" role="alert">
        <span className="strong">Something went wrong</span>
        <p className="mono muted">{this.state.message}</p>
        <p className="muted">Your work is saved. Reloading usually fixes this.</p>
        <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
