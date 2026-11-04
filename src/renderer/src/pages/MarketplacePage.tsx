import { useMemo, useState } from 'react'
import type { CatalogPackage, PackageKind } from '../../../shared/types'
import { bridge } from '../bridge'
import { Icon } from '../components/ui'
import { CATALOG, installedPackages, KIND_LABEL } from '../data/catalog'
import { serverState } from '../runState'
import { useApp } from '../store'
import { countOf } from '../usage'
import { ClawHubBrowser } from './ClawHubBrowser'
import { RegistryBrowser } from './RegistryBrowser'

type Filter = 'all' | 'agent' | 'workflow' | 'downloaded' | 'registry' | 'clawhub'

// MCP Servers and Agent Skills browse the live MCP Registry and ClawHub. The built-in servers and
// skills stay under All Resources and Downloaded.
const FILTERS: { id: Filter; label: string; icon?: string }[] = [
  { id: 'all', label: 'All Resources' },
  { id: 'registry', label: 'MCP Servers', icon: 'hub' },
  { id: 'clawhub', label: 'Agent Skills', icon: 'bolt' },
  { id: 'agent', label: 'Prebuilt Agents', icon: 'precision_manufacturing' },
  { id: 'workflow', label: 'Agent Workflows', icon: 'account_tree' },
  { id: 'downloaded', label: 'Downloaded', icon: 'download_done' }
]

const LIVE: Filter[] = ['registry', 'clawhub']

// The Downloaded tab groups what you have by type.
const SECTIONS: { kind: PackageKind; label: string }[] = [
  { kind: 'mcp', label: 'MCP Servers' },
  { kind: 'skill', label: 'Agent Skills' },
  { kind: 'agent', label: 'Prebuilt Agents' },
  { kind: 'workflow', label: 'Agent Workflows' }
]

const USE_HINT: Record<PackageKind, string> = {
  mcp: 'Add it to an agent in Agent Builder.',
  skill: 'Add it to an agent in Agent Builder.',
  agent: 'Drag it from the canvas Agents tab.',
  workflow: 'Add it from the canvas Workflows tab.'
}

function Facts({ pkg }: { pkg: CatalogPackage }) {
  const facts: [string, string][] = []
  if (pkg.kind === 'mcp') {
    facts.push(['Transport', pkg.transport ?? 'stdio'], ['Install', pkg.install ?? ''])
  } else if (pkg.kind === 'skill') {
    facts.push(['License', pkg.license ?? 'Not stated'], ['Author', pkg.author])
  } else if (pkg.agent) {
    facts.push(['Models', String(pkg.agent.models.length)], ['MCP Servers', String(pkg.agent.mcpServers.length)])
  } else if (pkg.workflow) {
    facts.push(['Agents', String(pkg.workflow.agents.length)], ['Connections', String(pkg.workflow.edges.length)])
  }

  return (
    <dl className="facts">
      {facts.map(([label, value]) => (
        <div key={label} className="fact">
          <dt className="eyebrow">{label}</dt>
          <dd className="mono truncate" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ServerStatus({ pkg }: { pkg: CatalogPackage }) {
  const check = useApp((state) => state.downloads[pkg.id]?.check)
  const checking = useApp((state) => state.mcpChecking.includes(pkg.id))
  const state = useApp((store) => serverState(pkg.id, store.downloads, store.mcpSetups, store.registryServers))
  const { checkMcpServer, setUi } = useApp.getState()

  if (checking) return <p className="mono faint package-hint">Starting the server. The first time can take a minute.</p>
  if (state === 'needs-setup') {
    return (
      <p className="mono warning-text package-hint">
        Needs setup.{' '}
        <button className="link" type="button" onClick={() => setUi({ settingsOpen: true })}>
          Open Settings
        </button>
      </p>
    )
  }
  if (check?.ok) return <p className="mono faint package-hint">Ready: {countOf(check.tools ?? 0, 'tool')}. Add it in Agent Builder.</p>
  return (
    <p className={`mono package-hint ${check ? 'package-error' : 'faint'}`}>
      {check ? check.message : 'Not tested yet.'}{' '}
      <button className="link" type="button" onClick={() => void checkMcpServer(pkg.id)}>
        {check ? 'Try again' : 'Test it'}
      </button>
    </p>
  )
}

function PackageCard({ pkg }: { pkg: CatalogPackage }) {
  const record = useApp((state) => state.downloads[pkg.id])
  const { downloadPackage, removePackage } = useApp.getState()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const attempt = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="package">
      <div className="row">
        <span className="kind">{KIND_LABEL[pkg.kind]}</span>
        <span className="grow" />
        {pkg.repo ? (
          <button className="source" type="button" onClick={() => void bridge.openExternal(pkg.repo!)}>
            Source
            <Icon name="open_in_new" size={13} />
          </button>
        ) : (
          <span className="mono faint">{pkg.author.includes('/') ? 'No source listed' : 'Included example'}</span>
        )}
      </div>

      <h3 className="package-name">{pkg.name}</h3>
      <span className="mono faint">{pkg.author}</span>
      <p className="package-summary">{pkg.summary}</p>

      <div className="tags">
        {pkg.tags.map((tag) => (
          <span key={tag} className="chip">
            {tag}
          </span>
        ))}
      </div>

      <Facts pkg={pkg} />

      <div className="package-actions">
        {record ? (
          <>
            <span className="downloaded mono">
              <Icon name="check" size={14} />
              Downloaded
            </span>
            <span className="grow" />
            <button
              className="icon-button"
              type="button"
              aria-label={`Show ${pkg.name} in Finder`}
              title="Show in Finder"
              onClick={() => void bridge.revealPath(record.path)}
            >
              <Icon name="folder_open" />
            </button>
            <button
              className="btn btn-destructive"
              type="button"
              disabled={busy}
              onClick={() => void attempt(() => removePackage(pkg))}
            >
              Remove
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary btn-block"
            type="button"
            disabled={busy}
            onClick={() => void attempt(() => downloadPackage(pkg))}
          >
            <Icon name="download" />
            Download
          </button>
        )}
      </div>
      {error && <p className="mono package-error package-hint">{error}</p>}
      {!error && record && pkg.kind === 'mcp' && <ServerStatus pkg={pkg} />}
      {!error && record && pkg.kind !== 'mcp' && <p className="mono faint package-hint">{USE_HINT[pkg.kind]}</p>}
    </article>
  )
}

export function MarketplacePage() {
  const downloads = useApp((state) => state.downloads)
  const registry = useApp((state) => state.registryServers)
  const clawhub = useApp((state) => state.clawhubSkills)
  const [filter, setFilter] = useState<Filter>('all')
  const [downloadedKind, setDownloadedKind] = useState<PackageKind | 'all'>('all')
  const [query, setQuery] = useState('')

  const matchesFilter = (pkg: CatalogPackage, id: Filter) =>
    id === 'all' || pkg.kind === id || (id === 'downloaded' && Boolean(downloads[pkg.id]))

  const packages = useMemo(() => [...CATALOG, ...installedPackages(registry, clawhub)], [registry, clawhub])
  const needle = query.trim().toLowerCase()
  const visible = packages.filter(
    (pkg) =>
      matchesFilter(pkg, filter) &&
      [pkg.name, pkg.author, pkg.summary, ...pkg.tags].join(' ').toLowerCase().includes(needle)
  )

  return (
    <div className="page-scroll">
      <div className="market">
        <header className="market-head">
          <h1>Agent Marketplace</h1>
          <p className="muted">
            Download open-source MCP servers and skills, plus example agents and workflows, to use on this Mac. MCP
            servers run third-party code here, so download only what you trust.
          </p>
        </header>

        <div className="field-icon market-search">
          <Icon name="search" />
          <input
            className="input"
            value={query}
            placeholder="Search MCP servers, skills, agents or workflows..."
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="filters" role="tablist">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`filter ${filter === item.id ? 'is-on' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.icon && <Icon name={item.icon} size={15} />}
              {item.label}
              {!LIVE.includes(item.id) && (
                <span className="mono">{packages.filter((pkg) => matchesFilter(pkg, item.id)).length}</span>
              )}
            </button>
          ))}
        </div>

        {filter === 'registry' ? (
          <RegistryBrowser query={query.trim()} />
        ) : filter === 'clawhub' ? (
          <ClawHubBrowser query={query.trim()} />
        ) : filter === 'downloaded' ? (
          <>
            {visible.length > 0 && (
              <div className="segmented downloaded-kinds" role="radiogroup" aria-label="Show downloaded">
                {[{ kind: 'all' as const, label: 'All' }, ...SECTIONS].map(({ kind, label }) => {
                  const count = kind === 'all' ? visible.length : visible.filter((pkg) => pkg.kind === kind).length
                  if (count === 0 && kind !== downloadedKind) return null
                  return (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={downloadedKind === kind}
                      className={downloadedKind === kind ? 'is-on' : ''}
                      onClick={() => setDownloadedKind(kind)}
                    >
                      {label}
                      <span>{count}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {SECTIONS.map(({ kind, label }) => {
              const group = visible.filter((pkg) => pkg.kind === kind)
              if (group.length === 0 || (downloadedKind !== 'all' && downloadedKind !== kind)) return null
              return (
                <section key={kind} className="market-section" aria-label={label}>
                  <div className="market-section-head">
                    <span className="eyebrow">{label}</span>
                    <span className="chip">{group.length}</span>
                  </div>
                  <div className="package-grid">
                    {group.map((pkg) => (
                      <PackageCard key={pkg.id} pkg={pkg} />
                    ))}
                  </div>
                </section>
              )
            })}
            {visible.length === 0 && <p className="empty">Nothing matches that search.</p>}
          </>
        ) : (
          <>
            <div className="package-grid">
              {visible.map((pkg) => (
                <PackageCard key={pkg.id} pkg={pkg} />
              ))}
            </div>
            {visible.length === 0 && <p className="empty">Nothing matches that search.</p>}
          </>
        )}
      </div>
    </div>
  )
}
