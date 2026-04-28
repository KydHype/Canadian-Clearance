import type { ClearanceItem, StoreLocation } from '../types'

const BASE = 'https://www.homedepot.ca'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'application/json',
  'Accept-Language': 'en-CA,en;q=0.9',
  'Referer': 'https://www.homedepot.ca/',
}

export async function findHDStores(postalCode: string): Promise<StoreLocation[]> {
  const clean = postalCode.replace(/\s/g, '').toUpperCase()
  const res = await fetch(
    `${BASE}/api/2.0/storelocator/store?postalCode=${clean}&maxResults=3`,
    { headers: HEADERS, next: { revalidate: 3600 } }
  )
  if (!res.ok) throw new Error(`HD store locator: ${res.status}`)
  const data = await res.json()
  const stores: StoreLocation[] = (data.stores ?? data ?? []).slice(0, 3).map((s: Record<string, unknown>) => ({
    storeNo: String(s.storeNumber ?? s.storeNo ?? s.id ?? ''),
    name: String(s.storeName ?? s.name ?? 'Home Depot'),
    address: String(s.address ?? ''),
    city: String(s.city ?? ''),
    province: String(s.province ?? s.state ?? ''),
    postalCode: String(s.postalCode ?? s.zip ?? ''),
    distance: typeof s.distance === 'number' ? s.distance : undefined,
  }))
  return stores
}

export async function getHDClearance(store: StoreLocation): Promise<ClearanceItem[]> {
  const url = `${BASE}/api/2.0/page/search?pageType=search&q=clearance&store=${store.storeNo}&pageSize=48&sortOrder=0&sortBy=7`
  const res = await fetch(url, { headers: HEADERS, next: { revalidate: 900 } })
  if (!res.ok) throw new Error(`HD search: ${res.status}`)
  const data = await res.json()

  const products: Record<string, unknown>[] = data.searchReport?.products
    ?? data.products
    ?? data.results
    ?? []

  return products.flatMap((p: Record<string, unknown>) => {
    const pricing = (p.pricing as Record<string, unknown>) ?? {}
    const original = Number(pricing.wasPrice ?? pricing.regularPrice ?? pricing.originalPrice ?? 0)
    const current = Number(pricing.specialPrice ?? pricing.currentPrice ?? pricing.nowPrice ?? pricing.price ?? 0)
    if (!current || current <= 0) return []

    const discount = original > current ? Math.round((1 - current / original) * 100) : 0

    return [{
      id: `hd-${store.storeNo}-${p.productId ?? p.sku}`,
      storeId: 'homedepot' as const,
      storeLocation: store,
      name: String(p.description ?? p.name ?? p.title ?? ''),
      brand: String(p.brandName ?? p.brand ?? ''),
      sku: String(p.productId ?? p.itemId ?? p.sku ?? ''),
      upc: p.upc ? String(p.upc) : undefined,
      originalPrice: original || current,
      clearancePrice: current,
      discountPercent: discount,
      category: String(p.category ?? p.categoryPath ?? ''),
      imageUrl: p.imageUrl ? String(p.imageUrl) : undefined,
      productUrl: p.productUrl ? `${BASE}${p.productUrl}` : undefined,
      inStock: p.storeSkuInventory !== false && p.inventory !== 0,
      isPenny: current <= 0.01,
    }]
  })
}
