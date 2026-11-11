import { useCallback, useEffect, useState } from 'react'
import type { RegistryEntry, RegistrySource } from '../../../shared/registry'
import { bridge } from '../bridge'
import { Icon, Kbd } from '../components/ui'
import { useEscape } from '../components/useEscape'
import { useApp } from '../store'

const SEARCH_DELAY_MS = 300

const SOURCE_LABEL: Record<RegistrySource, string> = { remote: 'Remote', npm: 'npm', pypi: 'PyPI' }

function InstallDialog({ entry, onClose }: { entry: RegistryEntry; onClose(): void }) {
  const { installRegistryServer } = useApp.getState()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isRemote = entry.source === 'remote'

  const close = useCallback(() => onClose(), [onClose])
  useEscape(close)

  const install = async () => {
    setBusy(true)
    setError('')
    try {
      await installRegistryServer(entry)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That server could not be installed.')
      setBusy(false)
    }
  }

  return (
    <div className="backdrop" onMouseDown={close} role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-label={`Install ${entry.title}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div className="tile">
            <Icon name="public" size={18} />
          </div>
          <div className="stack">
            <span className="strong">Install {entry.title}</span>
            <span className="eyebrow">Not reviewed</span>
          </div>
          <Kbd>ESC</Kbd>
        </div>

        <div className="install-body">
          <p className="muted">{isRemote ? 'Agents will connect to:' : 'This will download and run:'}</p>
          <div className="install-target mono">{entry.target}</div>
          <ul className="install-points">
            <li>Anyone can publish to this registry, and nobody has reviewed this server.</li>
            {isRemote ? (
              <>
                <li>No code runs on your Mac.</li>
                <li>Anything an agent sends to its tools goes to this address.</li>
              </>
            ) : (
              <>
                <li>It runs on your Mac with your permissions as soon as you continue.</li>
                <li>Approvals cover what agents do with it, not what the program itself does when it starts.</li>
              </>
            )}
            <li>Every tool it offers will ask for your approval, whatever it claims about itself.</li>
          </ul>
          {error && <p className="mono package-error">{error}</p>}
        </div>

        <div className="dialog-foot">
          {entry.repository ? (
            <button className="btn btn-ghost" type="button" onClick={() => void bridge.openExternal(entry.repository!)}>
              <Icon name="open_in_new" size={14} />
              View Source
            </button>
          ) : (
            <span className="mono faint">No source listed</span>
          )}
          <div className="row">
            <button className="btn btn-secondary" type="button" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void install()}>
              {busy ? 'Installing' : isRemote ? 'Connect' : 'Install and Run'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RegistryCard({ entry, onInstall }: { entry: RegistryEntry; onInstall(entry: RegistryEntry): void }) {
  const installed = useApp((state) =>
    Object.values(state.registryServers).some((server) => server.entry.name === entry.name)
  )

  return (
    <article className="package">
      <div className="row">
        <span className="kind">{entry.source ? SOURCE_LABEL[entry.source] : 'Other'}</span>
        <span className="chip">Not reviewed</span>
        {entry.deprecated && <span className="badge badge-warning">Deprecated</span>}
        <span className="grow" />
        {entry.repository && (
          <button className="source" type="button" onClick={() => void bridge.openExternal(entry.repository!)}>
            Source
            <Icon name="open_in_new" size={13} />
          </button>
        )}
      </div>

      <h3 className="package-name truncate">{entry.title}</h3>
      <span className="mono faint truncate" title={entry.name}>
        {entry.name}
      </span>
      <p className="package-summary">{entry.description}</p>

      <dl className="facts">
        <div className="fact">
          <dt className="eyebrow">Version</dt>
          <dd className="mono truncate">{entry.version}</dd>
        </div>
        <div className="fact">
          <dt className="eyebrow">{entry.source === 'remote' ? 'Address' : 'Package'}</dt>
          <dd className="mono truncate" title={entry.target}>
            {entry.target ?? 'Unavailable'}
          </dd>
        </div>
      </dl>

      <div className="package-actions">
        {installed ? (
          <span className="downloaded mono">
            <Icon name="check" size={14} />
            Installed. Find it under Downloaded.
          </span>
        ) : (
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={Boolean(entry.unsupported)}
            onClick={() => onInstall(entry)}
          >
            <Icon name={entry.source === 'remote' ? 'link' : 'download'} />
            {entry.source === 'remote' ? 'Connect' : 'Install'}
          </button>
        )}
      </div>
      {entry.unsupported && <p className="mono faint package-hint">{entry.unsupported}.</p>}
    </article>
  )
}

export function RegistryBrowser({ query }: { query: string }) {
  const [entries, setEntries] = useState<RegistryEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [installing, setInstalling] = useState<RegistryEntry | null>(null)

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')

    const timer = setTimeout(() => {
      bridge
        .searchRegistry(query)
        .then((page) => {
          if (!current) return
          setEntries(page.entries)
          setCursor(page.nextCursor)
        })
        .catch(() => current && setError('The MCP registry could not be reached.'))
        .finally(() => current && setLoading(false))
    }, SEARCH_DELAY_MS)

    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query])

  const loadMore = async () => {
    if (!cursor) return
    setLoading(true)
    try {
      const page = await bridge.searchRegistry(query, cursor)
      setEntries((previous) => [...previous, ...page.entries])
      setCursor(page.nextCursor)
    } catch {
      setError('The MCP registry could not be reached.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {error && <p className="empty">{error}</p>}
      {!error && !loading && entries.length === 0 && <p className="empty">Nothing in the registry matches that search.</p>}

      <div className="package-grid">
        {entries.map((entry) => (
          <RegistryCard key={`${entry.name}@${entry.version}`} entry={entry} onInstall={setInstalling} />
        ))}
      </div>

      {loading && <p className="empty">Loading the registry.</p>}
      {!loading && cursor && (
        <div className="registry-more">
          <button className="btn btn-secondary" type="button" onClick={() => void loadMore()}>
            Load More
          </button>
        </div>
      )}

      {installing && <InstallDialog entry={installing} onClose={() => setInstalling(null)} />}
    </>
  )
}
