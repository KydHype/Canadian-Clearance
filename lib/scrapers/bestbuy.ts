import type { ClearanceItem, StoreLocation } from '../types'

const BASE = 'https://www.bestbuy.ca'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'application/json',
  'Accept-Language': 'en-CA,en;q=0.9',
  'Referer': 'https://www.bestbuy.ca/',
}

export async function findBBStores(postalCode: string): Promise<StoreLocation[]> {
  const clean = postalCode.replace(/\s/g, '').toUpperCase()
  const res = await fetch(
    `${BASE}/api/2.0/stores?postalCode=${clean}&maxResults=3&currentRegion=CA`,
    { headers: HEADERS, next: { revalidate: 3600 } }
  )
  if (!res.ok) throw new Error(`BB store locator: ${res.status}`)
  const data = await res.json()
  const stores: Record<string, unknown>[] = data.stores ?? data ?? []
  return stores.slice(0, 3).map((s: Record<string, unknown>) => ({
    storeNo: String(s.id ?? s.storeId ?? s.locationId ?? ''),
    name: String(s.name ?? s.displayName ?? 'Best Buy'),
    address: String(s.address ?? s.streetAddress ?? ''),
    city: String(s.city ?? ''),
    province: String(s.province ?? s.region ?? ''),
    postalCode: String(s.postalCode ?? s.zip ?? ''),
    distance: typeof s.distance === 'number' ? s.distance : undefined,
  }))
}

export async function getBBClearance(store: StoreLocation): Promise<ClearanceItem[]> {
  const url = `${BASE}/api/2.0/page/search?currentRegion=CA&query=clearance&store=${store.storeNo}&pageSize=48&sortBy=priceLowToHigh`
  const res = await fetch(url, { headers: HEADERS, next: { revalidate: 900 } })
  if (!res.ok) throw new Error(`BB search: ${res.status}`)
  const data = await res.json()

  const products: Record<string, unknown>[] = data.products ?? data.results ?? data.items ?? []

  return products.flatMap((p: Record<string, unknown>) => {
    const pricing = (p.priceWithoutEhf as Record<string, unknown>)
      ?? (p.regularPrice as Record<string, unknown>)
      ?? {}
    const current = Number(p.salePrice ?? p.lowPrice ?? pricing.value ?? 0)
    const original = Number(p.regularPrice ?? pricing.originalPrice ?? 0)
    if (!current || current <= 0) return []

    const discount = original > current ? Math.round((1 - current / original) * 100) : 0

    return [{
      id: `bb-${store.storeNo}-${p.sku ?? p.id ?? p.productId}`,
      storeId: 'bestbuy' as const,
      storeLocation: store,
      name: String(p.name ?? p.shortDescription ?? p.description ?? ''),
      brand: String(p.brandName ?? p.brand ?? ''),
      sku: String(p.sku ?? p.id ?? p.modelNumber ?? ''),
      upc: p.upc ? String(p.upc) : undefined,
      originalPrice: original || current,
      clearancePrice: current,
      discountPercent: discount,
      category: String(p.categoryPath ?? p.category ?? ''),
      imageUrl: p.thumbnailImage ? String(p.thumbnailImage) : undefined,
      productUrl: p.productUrl ? `${BASE}${p.productUrl}` : undefined,
      inStock: p.availability !== 'SoldOut',
      isPenny: current <= 0.01,
    }]
  })
}
