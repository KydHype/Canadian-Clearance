import type { ClearanceItem, StoreLocation } from '../types'

const SEARCH_BASE = 'https://api.canadiantire.ca/search/api/v0/product'
const STORE_BASE = 'https://api.canadiantire.ca/store/api/v1'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'application/json',
  'Accept-Language': 'en-CA,en;q=0.9',
  'Referer': 'https://www.canadiantire.ca/',
  'baseSiteId': 'CTR',
  'Host': 'api.canadiantire.ca',
}

export async function findCTStores(postalCode: string): Promise<StoreLocation[]> {
  const clean = postalCode.replace(/\s/g, '').toUpperCase()
  const res = await fetch(
    `${STORE_BASE}/stores/?lat=0&lng=0&postalCode=${clean}&radius=50&maxCount=3`,
    { headers: HEADERS, next: { revalidate: 3600 } }
  )
  if (!res.ok) throw new Error(`CT store locator: ${res.status}`)
  const data = await res.json()
  const stores: Record<string, unknown>[] = data.stores ?? data ?? []
  return stores.slice(0, 3).map((s: Record<string, unknown>) => {
    const addr = (s.address ?? {}) as Record<string, unknown>
    const region = (addr.region ?? {}) as Record<string, unknown>
    return {
      storeNo: String(s.storeNumber ?? s.id ?? s.storeId ?? ''),
      name: String(s.displayName ?? s.name ?? 'Canadian Tire'),
      address: String(addr.line1 ?? s.address ?? ''),
      city: String(addr.town ?? s.city ?? ''),
      province: String(region.isocode ?? s.province ?? ''),
      postalCode: String(addr.postalCode ?? s.postalCode ?? ''),
      distance: typeof s.distance === 'number' ? s.distance : undefined,
    }
  })
}

export async function getCTClearance(store: StoreLocation): Promise<ClearanceItem[]> {
  const url = `${SEARCH_BASE}/search/?q=clearance&store=${store.storeNo}&lang=en_CA&pageSize=48&currentPage=0&sortBy=relevance&fields=FULL`
  const res = await fetch(url, { headers: HEADERS, next: { revalidate: 900 } })
  if (!res.ok) throw new Error(`CT search: ${res.status}`)
  const data = await res.json()

  const products: Record<string, unknown>[] = data.products ?? data.results ?? []

  return products.flatMap((p: Record<string, unknown>) => {
    const price = (p.price as Record<string, unknown>) ?? {}
    const wasPrice = (price.wasPrice as Record<string, unknown>) ?? {}
    const original = Number(wasPrice.value ?? price.formattedWasPrice ?? price.regularPrice ?? 0)
    const current = Number(price.value ?? price.formattedValue ?? price.currentPrice ?? 0)
    if (!current || current <= 0) return []

    const discount = original > current ? Math.round((1 - current / original) * 100) : 0
    const images = Array.isArray(p.images) ? (p.images as Record<string, unknown>[]) : []
    const firstImage = (images[0] ?? {}) as Record<string, unknown>
    const categories = Array.isArray(p.categories) ? (p.categories as Record<string, unknown>[]) : []
    const firstCat = (categories[0] ?? {}) as Record<string, unknown>
    const brand = (p.brand as Record<string, unknown>) ?? {}
    const stock = (p.stock as Record<string, unknown>) ?? {}

    return [{
      id: `ct-${store.storeNo}-${p.code ?? p.sku ?? p.id}`,
      storeId: 'canadiantire' as const,
      storeLocation: store,
      name: String(p.name ?? p.summary ?? p.description ?? ''),
      brand: String(brand.name ?? p.brandName ?? ''),
      sku: String(p.code ?? p.sku ?? p.partNumber ?? ''),
      upc: p.upc ? String(p.upc) : undefined,
      originalPrice: original || current,
      clearancePrice: current,
      discountPercent: discount,
      category: String(firstCat.name ?? p.category ?? ''),
      imageUrl: firstImage.url ? `https://cdn.canadiantire.ca${firstImage.url}` : undefined,
      productUrl: p.url ? `https://www.canadiantire.ca${p.url}` : undefined,
      inStock: stock.stockLevelStatus !== 'outOfStock',
      isPenny: current <= 0.01,
    }]
  })
}
