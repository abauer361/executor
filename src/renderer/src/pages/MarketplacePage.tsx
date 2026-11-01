import { useMemo, useState } from 'react'
import type { CatalogPackage, PackageKind } from '../../../shared/types'
import { bridge } from '../bridge'
import { Icon } from '../components/ui'
import { CATALOG, KIND_LABEL, registryPackage } from '../data/catalog'
import { serverState } from '../runState'
import { useApp } from '../store'
import { countOf } from '../usage'
import { RegistryBrowser } from './RegistryBrowser'

type Filter = 'all' | PackageKind | 'downloaded' | 'registry'

const FILTERS: { id: Filter; label: string; icon?: string }[] = [
  { id: 'all', label: 'All Resources' },
  { id: 'mcp', label: 'MCP Servers', icon: 'hub' },
  { id: 'skill', label: 'Agent Skills', icon: 'bolt' },
  { id: 'agent', label: 'Prebuilt Agents', icon: 'precision_manufacturing' },
  { id: 'workflow', label: 'Agent Workflows', icon: 'account_tree' },
  { id: 'downloaded', label: 'Downloaded', icon: 'download_done' },
  { id: 'registry', label: 'MCP Registry', icon: 'public' }
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
    facts.push(['Format', 'SKILL.md'], ['Author', pkg.author])
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
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const matchesFilter = (pkg: CatalogPackage, id: Filter) =>
    id === 'all' || pkg.kind === id || (id === 'downloaded' && Boolean(downloads[pkg.id]))

  const packages = useMemo(() => [...CATALOG, ...Object.values(registry).map(registryPackage)], [registry])
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
              {item.id !== 'registry' && (
                <span className="mono">{packages.filter((pkg) => matchesFilter(pkg, item.id)).length}</span>
              )}
            </button>
          ))}
        </div>

        {filter === 'registry' ? (
          <RegistryBrowser query={query.trim()} />
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
