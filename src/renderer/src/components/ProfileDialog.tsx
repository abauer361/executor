import { useCallback, useMemo, useState } from 'react'
import { summarizeUsage, type Account, type SignInProvider, type UsageTotal } from '../../../shared/account'
import { PROVIDER_LABEL, RUNNABLE_MODELS } from '../../../shared/pricing'
import { modelName } from '../data/models'
import { useApp } from '../store'
import { countOf, formatDollars, formatTokens } from '../usage'
import { Icon, Kbd } from './ui'
import { useEscape } from './useEscape'

type Tab = 'account' | 'usage' | 'preferences'

const TABS: { id: Tab; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'usage', label: 'Usage' },
  { id: 'preferences', label: 'Preferences' }
]

const SIGN_IN_LABEL: Record<SignInProvider, string> = { github: 'GitHub', google: 'Google' }

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '?'

export function Avatar({ account, size = 32 }: { account: Account; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {initialsOf(account.name)}
    </span>
  )
}

export function ProfileDialog() {
  const open = useApp((state) => state.profileOpen)
  if (!open) return null
  return <ProfilePanel />
}

function SignedOut() {
  const connected = useApp((state) => state.accountState.connected)
  const { signIn } = useApp.getState()
  const [busy, setBusy] = useState<SignInProvider | null>(null)
  const [error, setError] = useState('')

  const start = async (provider: SignInProvider) => {
    setBusy(provider)
    setError('')
    try {
      const result = await signIn(provider)
      if (!result.ok) setError(result.message ?? 'Sign-in did not finish.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in did not finish.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <p className="muted">
        Sign in to keep your agents and workflows with your account, see usage across your Macs and manage your plan.
        Your provider API keys always stay on this Mac.
      </p>
      <div className="profile-sign-in">
        {(['github', 'google'] as const).map((provider) => (
          <button
            key={provider}
            className="btn btn-secondary btn-block"
            type="button"
            disabled={!connected || busy !== null}
            onClick={() => void start(provider)}
          >
            {busy === provider ? 'Waiting for your browser' : `Continue with ${SIGN_IN_LABEL[provider]}`}
          </button>
        ))}
      </div>
      {!connected && <p className="mono faint">Accounts are not switched on in this build yet. Everything else works without one.</p>}
      {error && <p className="mono package-error">{error}</p>}
    </>
  )
}

function SignedIn({ account }: { account: Account }) {
  const plan = useApp((state) => state.accountState.plan)
  const { signOut } = useApp.getState()

  return (
    <>
      <div className="profile-card row">
        <Avatar account={account} size={40} />
        <div className="stack grow">
          <span className="strong truncate">{account.name}</span>
          <span className="mono muted truncate">{account.email}</span>
        </div>
        <span className="chip">{SIGN_IN_LABEL[account.provider]}</span>
        <button className="btn btn-secondary" type="button" onClick={() => void signOut()}>
          Sign Out
        </button>
      </div>

      <span className="eyebrow settings-section">Plan</span>
      <div className="profile-card row">
        <div className="stack grow">
          <span className="strong">{plan?.name ?? 'No plan yet'}</span>
          <span className="mono muted">
            {plan?.renewsAt
              ? `Renews ${new Date(plan.renewsAt).toLocaleDateString()}`
              : 'Executor is free while paid plans are being set up.'}
          </span>
        </div>
        {plan && plan.status !== 'active' && (
          <span className="badge badge-warning">{plan.status === 'past_due' ? 'Payment due' : 'Canceled'}</span>
        )}
      </div>
    </>
  )
}

function Stat({ label, total }: { label: string; total: UsageTotal }) {
  return (
    <div className="profile-card stack">
      <span className="eyebrow">{label}</span>
      <span className="usage-figure">{formatDollars(total.cost)}</span>
      <span className="mono muted">
        {formatTokens(total.tokens)} tokens · {countOf(total.runs, 'run')}
      </span>
    </div>
  )
}

const monthLabel = (month: string) => {
  const [year, index] = month.split('-').map(Number)
  return new Date(year, index - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function UsageRows({ rows }: { rows: { key: string; label: string; cost: number; detail: string }[] }) {
  const most = Math.max(...rows.map((row) => row.cost), 0)
  return (
    <div className="usage-rows">
      {rows.map((row) => (
        <div key={row.key} className="usage-row">
          <span className="truncate">{row.label}</span>
          <div className="meter">
            <span style={{ width: `${most > 0 ? Math.round((row.cost / most) * 100) : 0}%` }} />
          </div>
          <span className="mono muted usage-detail">{row.detail}</span>
          <span className="mono usage-cost">{formatDollars(row.cost)}</span>
        </div>
      ))}
    </div>
  )
}

function Usage() {
  const runs = useApp((state) => state.runs)
  const signedIn = useApp((state) => state.accountState.account !== null)
  const usage = useMemo(() => summarizeUsage(runs), [runs])

  if (usage.allTime.runs === 0) {
    return <p className="empty">No runs yet. Usage appears here after your first run.</p>
  }

  return (
    <>
      <div className="usage-stats">
        <Stat label="This month" total={usage.thisMonth} />
        <Stat label="All time" total={usage.allTime} />
      </div>

      <span className="eyebrow settings-section">By provider</span>
      <UsageRows
        rows={usage.providers.map((entry) => ({
          key: entry.provider,
          label: PROVIDER_LABEL[entry.provider],
          cost: entry.cost,
          detail: `${formatTokens(entry.tokens)} tokens`
        }))}
      />

      <span className="eyebrow settings-section">By month</span>
      <UsageRows
        rows={usage.months.map((entry) => ({
          key: entry.month,
          label: monthLabel(entry.month),
          cost: entry.cost,
          detail: countOf(entry.runs, 'run')
        }))}
      />

      <span className="eyebrow settings-section">Top workflows</span>
      <UsageRows
        rows={usage.workflows.map((entry) => ({
          key: entry.workflowId,
          label: entry.name,
          cost: entry.cost,
          detail: countOf(entry.runs, 'run')
        }))}
      />

      <p className="mono faint">
        {signedIn ? 'Counted from runs on this Mac until sync is switched on.' : 'Counted from runs on this Mac.'} Costs
        are what each provider billed for the run. Only these numbers are kept, never prompts or output.
      </p>
    </>
  )
}

function Preferences() {
  const theme = useApp((state) => state.theme)
  const preferences = useApp((state) => state.preferences)
  const { setTheme, setPreferences } = useApp.getState()
  const limiter = preferences.defaultLimiter
  const isTokens = limiter.mode === 'tokens'

  return (
    <>
      <div className="profile-card row">
        <div className="stack grow">
          <span className="strong">Appearance</span>
          <span className="muted">How Executor looks.</span>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Appearance">
          {(['dark', 'light'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={theme === option}
              className={theme === option ? 'is-on' : ''}
              onClick={() => setTheme(option)}
            >
              {option === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
      </div>

      <div className="profile-card row">
        <div className="stack grow">
          <span className="strong">Default model</span>
          <span className="muted">The model a new agent starts with.</span>
        </div>
        <select
          className="select select-chip profile-select"
          aria-label="Default model"
          value={preferences.defaultModel}
          onChange={(event) => setPreferences({ defaultModel: event.target.value })}
        >
          {RUNNABLE_MODELS.map((id) => (
            <option key={id} value={id}>
              {modelName(id)}
            </option>
          ))}
        </select>
      </div>

      <div className="profile-card row">
        <div className="stack grow">
          <span className="strong">Default limit</span>
          <span className="muted">The most a new agent may use in one run.</span>
        </div>
        <input
          className="input mono-input profile-limit"
          type="number"
          min={0}
          step={isTokens ? 1000 : 0.5}
          value={isTokens ? limiter.tokens : limiter.dollars}
          aria-label={isTokens ? 'Default token limit' : 'Default dollar limit'}
          onChange={(event) =>
            setPreferences({
              defaultLimiter: { ...limiter, [isTokens ? 'tokens' : 'dollars']: Math.max(0, Number(event.target.value) || 0) }
            })
          }
        />
        <div className="segmented" role="radiogroup" aria-label="Default limit unit">
          {(['tokens', 'dollars'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={limiter.mode === mode}
              className={limiter.mode === mode ? 'is-on' : ''}
              onClick={() => setPreferences({ defaultLimiter: { ...limiter, mode } })}
            >
              {mode === 'tokens' ? 'Tokens' : 'Dollars'}
            </button>
          ))}
        </div>
      </div>
      <p className="mono faint">These apply to agents you create from now on. Existing agents keep their own settings.</p>
    </>
  )
}

function ProfilePanel() {
  const account = useApp((state) => state.accountState.account)
  const { setUi } = useApp.getState()
  const [tab, setTab] = useState<Tab>('account')

  const close = useCallback(() => setUi({ profileOpen: false }), [setUi])
  useEscape(close)

  return (
    <div className="backdrop" onMouseDown={close} role="presentation">
      <div className="dialog" role="dialog" aria-label="Profile" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          {account ? (
            <Avatar account={account} />
          ) : (
            <div className="tile">
              <Icon name="person" size={18} />
            </div>
          )}
          <div className="stack">
            <span className="strong">{account?.name ?? 'Profile'}</span>
            <span className="eyebrow">{account ? account.email : 'Not signed in'}</span>
          </div>
          <Kbd>ESC</Kbd>
        </div>

        <div className="profile-tabs tab-list" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`tab ${tab === item.id ? 'is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="settings-body profile-body">
          {tab === 'account' && (account ? <SignedIn account={account} /> : <SignedOut />)}
          {tab === 'usage' && <Usage />}
          {tab === 'preferences' && <Preferences />}
        </div>
      </div>
    </div>
  )
}
