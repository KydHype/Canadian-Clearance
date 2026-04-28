const CACHE_KEY = 'cc_seen'
const MAX_AGE_DAYS = 14

interface SeenCache {
  [itemId: string]: number // unix timestamp ms when first seen
}

function loadCache(): SeenCache {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as SeenCache
  } catch {
    return {}
  }
}

function saveCache(cache: SeenCache) {
  try {
    // Prune entries older than MAX_AGE_DAYS to keep localStorage lean
    const cutoff = Date.now() - MAX_AGE_DAYS * 86400_000
    const pruned: SeenCache = {}
    for (const [id, ts] of Object.entries(cache)) {
      if (ts > cutoff) pruned[id] = ts
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(pruned))
  } catch {}
}

export function recordSeen(itemIds: string[]) {
  const cache = loadCache()
  const now = Date.now()
  let changed = false
  for (const id of itemIds) {
    if (!cache[id]) {
      cache[id] = now
      changed = true
    }
  }
  if (changed) saveCache(cache)
}

export function getFreshnessScore(itemId: string): number {
  const cache = loadCache()
  const firstSeen = cache[itemId]
  if (!firstSeen) return 100 // never seen before = brand new find

  const ageMs = Date.now() - firstSeen
  const ageDays = ageMs / 86400_000

  // Score 100 → 0 over 14 days
  const score = Math.max(0, Math.round(100 - (ageDays / MAX_AGE_DAYS) * 100))
  return score
}

export function getFreshnessLabel(score: number): {
  label: string
  color: string
  bg: string
  ring: string
} {
  if (score >= 80) return { label: 'Fresh', color: '#4ade80', bg: '#052e16', ring: '#16a34a' }
  if (score >= 50) return { label: 'Recent', color: '#facc15', bg: '#1c1500', ring: '#ca8a04' }
  if (score >= 25) return { label: 'Aging', color: '#fb923c', bg: '#1c0a00', ring: '#c2410c' }
  return { label: 'Stale', color: '#f87171', bg: '#1c0000', ring: '#dc2626' }
}
