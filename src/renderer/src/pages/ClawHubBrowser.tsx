import { useCallback, useEffect, useState } from 'react'
import type { ClawHubEntry, ClawHubPreview } from '../../../shared/clawhub'
import { bridge } from '../bridge'
import { Icon, Kbd } from '../components/ui'
import { useEscape } from '../components/useEscape'
import { useApp } from '../store'
import { countOf } from '../usage'
import { CLAWHUB_SOURCE, useBrowse } from './useBrowse'

const messageOf = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)

function InstallDialog({ entry, onClose }: { entry: ClawHubEntry; onClose(): void }) {
  const { installClawHubSkill } = useApp.getState()
  const [preview, setPreview] = useState<ClawHubPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const close = useCallback(() => onClose(), [onClose])
  useEscape(close)

  useEffect(() => {
    let current = true
    bridge
      .previewClawHubSkill(entry.owner, entry.slug)
      .then((result) => current && setPreview(result))
      .catch((cause) => current && setError(messageOf(cause, 'That skill could not be read from ClawHub.')))
    return () => {
      current = false
    }
  }, [entry])

  const install = async () => {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      await installClawHubSkill(preview)
      onClose()
    } catch (cause) {
      setError(messageOf(cause, 'That skill could not be installed.'))
      setBusy(false)
    }
  }

  return (
    <div className="backdrop" onMouseDown={close} role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-label={`Install ${entry.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div className="tile">
            <Icon name="storefront" size={18} />
          </div>
          <div className="stack">
            <span className="strong">Install {entry.name}</span>
            <span className="eyebrow">Not reviewed · {entry.owner}</span>
          </div>
          <Kbd>ESC</Kbd>
        </div>

        <div className="install-body">
          {!preview && !error && <p className="muted">Checking it with ClawHub.</p>}
          {preview && (
            <>
              <p className="mono muted">
                Version {preview.version} · {preview.license} · Clean on ClawHub's scans
              </p>
              {preview.warnings.map((warning) => (
                <p key={warning} className="mono warning-text">
                  {warning}
                </p>
              ))}
              <ul className="install-points">
                <li>Anyone can publish to ClawHub, and malicious skills have been found there before.</li>
                <li>Below is the full text an agent will read. Look for instructions you would not want an agent to follow.</li>
                <li>Executor never runs a skill's scripts, and agents still ask before anything that changes something.</li>
                {preview.otherFiles.length > 0 && (
                  <li>
                    It comes with {countOf(preview.otherFiles.length, 'other file')}, such as {preview.otherFiles.slice(0, 3).join(', ')}.
                    Executor only loads SKILL.md, so it may not work fully.
                  </li>
                )}
              </ul>
              <pre className="skill-text mono">{preview.text}</pre>
            </>
          )}
          {error && <p className="mono package-error">{error}</p>}
        </div>

        <div className="dialog-foot">
          <button className="btn btn-ghost" type="button" onClick={() => void bridge.openExternal(entry.url)}>
            <Icon name="open_in_new" size={14} />
            View on ClawHub
          </button>
          <div className="row">
            <button className="btn btn-secondary" type="button" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-primary" type="button" disabled={!preview || busy} onClick={() => void install()}>
              {busy ? 'Installing' : 'Install'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ClawHubCard({ entry, onInstall }: { entry: ClawHubEntry; onInstall(entry: ClawHubEntry): void }) {
  const installed = useApp((state) =>
    Object.values(state.clawhubSkills).some((skill) => skill.owner === entry.owner && skill.slug === entry.slug)
  )

  return (
    <article className="package">
      <div className="row">
        <span className="kind">ClawHub</span>
        <span className="chip">Not reviewed</span>
        <span className="grow" />
        <button className="source" type="button" onClick={() => void bridge.openExternal(entry.url)}>
          View
          <Icon name="open_in_new" size={13} />
        </button>
      </div>

      <h3 className="package-name truncate">{entry.name}</h3>
      <span className="mono faint truncate">{entry.owner}</span>
      <p className="package-summary">{entry.summary}</p>

      <dl className="facts">
        <div className="fact">
          <dt className="eyebrow">Downloads</dt>
          <dd className="mono">{entry.downloads.toLocaleString()}</dd>
        </div>
        <div className="fact">
          <dt className="eyebrow">Skill</dt>
          <dd className="mono truncate" title={`@${entry.owner}/${entry.slug}`}>
            @{entry.owner}/{entry.slug}
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
          <button className="btn btn-primary btn-block" type="button" onClick={() => onInstall(entry)}>
            <Icon name="visibility" />
            Review and Install
          </button>
        )}
      </div>
    </article>
  )
}

export function ClawHubBrowser({ query }: { query: string }) {
  const { entries, cursor, loading, error, loadMore } = useBrowse(CLAWHUB_SOURCE, query)
  const [installing, setInstalling] = useState<ClawHubEntry | null>(null)

  return (
    <>
      {error && <p className="empty">{error}</p>}
      {!error && !loading && entries.length === 0 && <p className="empty">Nothing on ClawHub matches that search.</p>}

      <div className="package-grid">
        {entries.map((entry) => (
          <ClawHubCard key={`${entry.owner}/${entry.slug}`} entry={entry} onInstall={setInstalling} />
        ))}
      </div>

      {loading && <p className="empty">Loading ClawHub.</p>}
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
