interface GraphEdge {
  source: string
  target: string
}

export function incomingByNode(ids: string[], edges: GraphEdge[]) {
  const known = new Set(ids)
  const incoming = new Map(ids.map((id) => [id, [] as string[]]))
  for (const edge of edges) {
    if (known.has(edge.source) && known.has(edge.target)) incoming.get(edge.target)?.push(edge.source)
  }
  return incoming
}

export function hasCycle(ids: string[], edges: GraphEdge[]) {
  const incoming = incomingByNode(ids, edges)
  const resolved = new Set<string>()
  let progressed = true
  while (progressed) {
    progressed = false
    for (const [id, sources] of incoming) {
      if (!resolved.has(id) && sources.every((source) => resolved.has(source))) {
        resolved.add(id)
        progressed = true
      }
    }
  }
  return resolved.size < ids.length
}
