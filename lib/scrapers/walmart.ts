import type { ClearanceItem, StoreLocation } from '../types'

const BASE = 'https://www.walmart.ca'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-CA,en;q=0.9',
  'Referer': 'https://www.walmart.ca/',
}

export async function findWalmartStores(postalCode: string): Promise<StoreLocation[]> {
  const clean = postalCode.replace(/\s/g, '').toUpperCase()
  const res = await fetch(
    `${BASE}/api/restfulservices/v2/stores?postal=${clean}&count=3`,
    { headers: HEADERS, next: { revalidate: 3600 } }
  )
  if (!res.ok) throw new Error(`Walmart store locator: ${res.status}`)
  const data = await res.json()
  const stores: Record<string, unknown>[] = data.stores ?? data.nearestStores ?? data ?? []
  return stores.slice(0, 3).map((s: Record<string, unknown>) => {
    const addr = (s.address ?? {}) as Record<string, unknown>
    return {
      storeNo: String(s.storeId ?? s.id ?? s.storeNo ?? ''),
      name: String(s.displayName ?? s.name ?? 'Walmart'),
      address: String(addr.streetAddress ?? s.address ?? ''),
      city: String(addr.city ?? s.city ?? ''),
      province: String(addr.province ?? s.province ?? ''),
      postalCode: String(addr.postalCode ?? s.postalCode ?? ''),
      distance: typeof s.distance === 'number' ? s.distance : undefined,
    }
  })
}

export async function getWalmartClearance(store: StoreLocation): Promise<ClearanceItem[]> {
  const url = `${BASE}/api/search?q=clearance&c=0&facet=dealer%3ANA%3ANA%3AClearance%3ANA%3ANA&storeId=${store.storeNo}&pageSize=48`
  const res = await fetch(url, { headers: HEADERS, next: { revalidate: 900 } })
  if (!res.ok) throw new Error(`Walmart search: ${res.status}`)
  const data = await res.json()

  const products: Record<string, unknown>[] = data.items ?? data.products ?? data.results ?? []

  return products.flatMap((p: Record<string, unknown>) => {
    const pricing = (p.priceInfo as Record<string, unknown>)
      ?? (p.price as Record<string, unknown>)
      ?? {}
    const original = Number(pricing.wasPrice ?? pricing.regularPrice ?? pricing.listPrice ?? 0)
    const current = Number(pricing.currentPrice ?? pricing.salePrice ?? pricing.price ?? p.salePrice ?? p.price ?? 0)
    if (!current || current <= 0) return []

    const discount = original > current ? Math.round((1 - current / original) * 100) : 0

    const images = (p.images as Record<string, unknown>[]) ?? []
    const imageUrl = images[0]?.url ?? p.imageUrl ?? p.image

    return [{
      id: `wm-${store.storeNo}-${p.itemId ?? p.id ?? p.sku}`,
      storeId: 'walmart' as const,
      storeLocation: store,
      name: String(p.name ?? p.description ?? p.title ?? ''),
      brand: String(p.brand ?? p.brandName ?? ''),
      sku: String(p.itemId ?? p.id ?? p.sku ?? ''),
      upc: p.upc ? String(p.upc) : undefined,
      originalPrice: original || current,
      clearancePrice: current,
      discountPercent: discount,
      category: String(p.category ?? p.categoryPath ?? ''),
      imageUrl: imageUrl ? String(imageUrl) : undefined,
      productUrl: p.canonicalUrl ? `${BASE}${p.canonicalUrl}` : undefined,
      inStock: p.availabilityStatus !== 'OUT_OF_STOCK',
      isPenny: current <= 0.01,
    }]
  })
}
