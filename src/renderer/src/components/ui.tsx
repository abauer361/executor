import type { AgentStatus, WorkflowStatus } from '../../../shared/types'

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: size }} aria-hidden="true">
      {name}
    </span>
  )
}

export function StatusDot({ status }: { status: AgentStatus | WorkflowStatus }) {
  return <span className={`dot dot-${status}`} />
}

export function StatusBadge({ status }: { status: WorkflowStatus }) {
  return <span className={`badge badge-${status}`}>{status}</span>
}

export function Kbd({ children }: { children: string }) {
  return <kbd className="kbd">{children}</kbd>
}

const FACES = [
  <>
    <circle cx="8.5" cy="11" fill="currentColor" r="1.5" />
    <circle cx="15.5" cy="11" fill="currentColor" r="1.5" />
    <path d="M10 15.5h4" strokeLinecap="round" />
  </>,
  <>
    <circle cx="8" cy="11.5" fill="currentColor" r="1.3" />
    <circle cx="16" cy="11.5" fill="currentColor" r="1.3" />
    <path d="M9.5 15c1 .8 4 .8 5 0" strokeLinecap="round" />
  </>,
  <>
    <path d="M7 11h3M14 11h3" strokeLinecap="round" />
    <circle cx="12" cy="15.5" fill="currentColor" r="1" />
  </>,
  <>
    <path d="M8 10.5v2M16 10.5v2" strokeLinecap="round" />
    <ellipse cx="12" cy="15" rx="1.5" ry="1" />
  </>,
  <>
    <circle cx="8" cy="11" fill="currentColor" r="1.5" />
    <circle cx="16" cy="11" fill="currentColor" r="1.5" />
    <path d="M10 15h4" strokeLinecap="round" />
  </>
]

export function RobotFace({ face, size = 24 }: { face: number; size?: number }) {
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <rect height="16" rx="4" width="18" x="3" y="4" />
      {FACES[face % FACES.length]}
      <path d="M12 2v2" />
    </svg>
  )
}
