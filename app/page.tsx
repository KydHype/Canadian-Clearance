'use client'

import { useState, useCallback, useEffect } from 'react'
import type { StoreId, StoreResult, ClearanceItem, SavedItem } from '@/lib/types'
import { STORE_META } from '@/lib/types'
import ItemCard from '@/components/ItemCard'
import SavedDrawer from '@/components/SavedDrawer'
import { recordSeen, getFreshnessScore } from '@/lib/freshness'

const ALL_STORES: StoreId[] = ['homedepot', 'walmart', 'canadiantire', 'bestbuy']

const DISCOUNT_OPTIONS = [
  { label: 'Any deal', value: 0 },
  { label: '25%+ off', value: 25 },
  { label: '50%+ off', value: 50 },
  { label: '70%+ off', value: 70 },
  { label: 'Penny only', value: 99 },
]

function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored) setValue(JSON.parse(stored) as T)
    } catch {}
  }, [key])
  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue(prev => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
      try { localStorage.setItem(key, JSON.stringify(next)) } catch {}
      return next
    })
  }, [key])
  return [value, set] as const
}

export default function Home() {
  const [postalCode, setPostalCode] = useLocalStorage('cc_postal', '')
  const [selectedStores, setSelectedStores] = useLocalStorage<StoreId[]>('cc_stores', ALL_STORES)
  const [minDiscount, setMinDiscount] = useLocalStorage('cc_discount', 0)
  const [results, setResults] = useState<StoreResult[]>([])
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [error, setError] = useState('')
  const [savedItems, setSavedItems] = useLocalStorage<SavedItem[]>('cc_saved', [])
  const [activeTab, setActiveTab] = useState<StoreId | 'all'>('all')

  const savedIds = new Set(savedItems.map(i => i.id))

  function toggleStore(id: StoreId) {
    setSelectedStores(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
  }

  async function search() {
    const clean = postalCode.replace(/\s/g, '').toUpperCase()
    if (clean.length < 6) { setError('Enter a valid Canadian postal code'); return }
    if (selectedStores.length === 0) { setError('Select at least one store'); return }
    setError('')
    setLoading(true)
    setHasSearched(true)
    setResults([])
    setActiveTab('all')

    // Fetch one store at a time — keeps each request under Vercel's 25s timeout
    // and respects ScraperAPI's 1 concurrent request limit on free plan
    for (const storeId of selectedStores) {
      // Add a loading placeholder so the UI shows the store is in progress
      setResults(prev => [...prev, { storeId, storeName: STORE_META[storeId].label, items: [], loading: true }])
      try {
        const res = await fetch(`/api/clearance?postal=${clean}&store=${storeId}&minDiscount=${minDiscount}`)
        const data = await res.json() as { storeId: StoreId; items: import('@/lib/types').ClearanceItem[]; error?: string }
        recordSeen(data.items.map(i => i.id))
        setResults(prev => prev.map(r =>
          r.storeId === storeId ? { ...r, items: data.items, error: data.error, loading: false } : r
        ))
      } catch (err) {
        setResults(prev => prev.map(r =>
          r.storeId === storeId ? { ...r, error: err instanceof Error ? err.message : 'Failed', loading: false } : r
        ))
      }
    }
    setLoading(false)
  }

  function saveItem(item: ClearanceItem) {
    setSavedItems(prev => [...prev, { ...item, savedAt: new Date().toISOString() }])
  }
  function unsaveItem(id: string) {
    setSavedItems(prev => prev.filter(i => i.id !== id))
  }
  function updateNote(id: string, note: string) {
    setSavedItems(prev => prev.map(i => i.id === id ? { ...i, note } : i))
  }

  const visibleResults = activeTab === 'all'
    ? results
    : results.filter(r => r.storeId === activeTab)

  const totalItems = results.reduce((n, r) => n + r.items.length, 0)

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-zinc-950/95 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🍁</span>
            <div>
              <h1 className="text-lg font-bold text-white leading-none">Canadian Clearance</h1>
              <p className="text-xs text-zinc-500">Hidden deals at Canadian stores</p>
            </div>
          </div>

          {/* Postal code + search */}
          <div className="flex gap-2">
            <input
              type="text"
              value={postalCode}
              onChange={e => setPostalCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="Postal code (e.g. T2P 0B3)"
              maxLength={7}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 text-sm font-mono tracking-wider"
            />
            <button
              onClick={search}
              disabled={loading}
              className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-colors"
            >
              {loading ? '...' : 'Scan'}
            </button>
          </div>

          {error && <p className="text-red-400 text-xs mt-1">{error}</p>}

          {/* Store selector */}
          <div className="flex gap-2 mt-2 flex-wrap">
            {ALL_STORES.map(id => {
              const meta = STORE_META[id]
              const active = selectedStores.includes(id)
              return (
                <button
                  key={id}
                  onClick={() => toggleStore(id)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors font-medium ${
                    active
                      ? 'border-transparent text-black'
                      : 'border-zinc-700 text-zinc-500 bg-transparent hover:border-zinc-500'
                  }`}
                  style={active ? { backgroundColor: meta.color } : {}}
                >
                  {meta.label}
                </button>
              )
            })}
          </div>

          {/* Discount filter */}
          <div className="flex gap-2 mt-2 overflow-x-auto pb-0.5">
            {DISCOUNT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setMinDiscount(opt.value)}
                className={`text-xs px-3 py-1 rounded-full border whitespace-nowrap transition-colors ${
                  minDiscount === opt.value
                    ? 'bg-zinc-100 text-black border-transparent font-semibold'
                    : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Results */}
      <main className="max-w-2xl mx-auto px-4 py-4">
        {loading && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm">Starting scan…</p>
          </div>
        )}

        {!loading && hasSearched && (
          <>
            {/* Store tabs */}
            {results.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
                <button
                  onClick={() => setActiveTab('all')}
                  className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors flex-shrink-0 ${
                    activeTab === 'all'
                      ? 'bg-white text-black font-bold'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  All ({totalItems})
                </button>
                {results.map(r => (
                  <button
                    key={r.storeId}
                    onClick={() => setActiveTab(r.storeId)}
                    className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors flex-shrink-0 ${
                      activeTab === r.storeId
                        ? 'bg-white text-black font-bold'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    {r.loading ? `${r.storeName} ⏳` : `${r.storeName} (${r.items.length})${r.error ? ' ⚠' : ''}`}
                  </button>
                ))}
              </div>
            )}

            {/* Error per store */}
            {visibleResults.map(r => r.error && (
              <div key={r.storeId} className="mb-3 bg-zinc-900 border border-zinc-700 rounded-xl p-3">
                <p className="text-yellow-400 text-xs font-semibold">{r.storeName} — Could not load</p>
                <p className="text-zinc-500 text-xs mt-0.5">{r.error}</p>
                <p className="text-zinc-600 text-xs mt-1">The store&apos;s API may have changed. You can still search manually via their app.</p>
              </div>
            ))}

            {/* Items grid */}
            {visibleResults.flatMap(r => r.items).length === 0 && !visibleResults.some(r => r.error) && (
              <div className="text-center py-16">
                <p className="text-4xl mb-3">🔍</p>
                <p className="text-zinc-400">No clearance items found matching your filters.</p>
                <p className="text-zinc-600 text-sm mt-1">Try lowering the discount threshold or selecting more stores.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visibleResults
                .flatMap(r => r.items)
                .map(item => ({ item, score: getFreshnessScore(item.id) }))
                .sort((a, b) => b.score - a.score)
                .map(({ item, score }) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  freshnessScore={score}
                  saved={savedIds.has(item.id)}
                  onSave={saveItem}
                  onUnsave={unsaveItem}
                />
              ))}
            </div>
          </>
        )}

        {!loading && !hasSearched && (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">🏷️</p>
            <p className="text-zinc-300 font-medium mb-1">Find hidden clearance items</p>
            <p className="text-zinc-500 text-sm">Enter your postal code and tap Scan</p>
            <div className="mt-6 text-left bg-zinc-900 rounded-xl p-4 text-xs text-zinc-500 max-w-xs mx-auto space-y-1.5">
              <p className="text-zinc-400 font-semibold mb-2">How it works</p>
              <p>• Enter your postal code to find nearby stores</p>
              <p>• We scan for items marked as clearance/discontinued</p>
              <p>• <span className="text-yellow-400 font-bold">PENNY</span> items ($0.01) ring up cheap at checkout</p>
              <p>• Copy the SKU to search in the store&apos;s app</p>
              <p>• Save items to your list for in-store hunting</p>
            </div>
          </div>
        )}
      </main>

      <SavedDrawer items={savedItems} onUnsave={unsaveItem} onUpdateNote={updateNote} />
    </div>
  )
}
