import { NextRequest, NextResponse } from 'next/server'
import type { StoreId, StoreResult, StoreLocation, ClearanceItem } from '@/lib/types'

export const runtime = 'edge'

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-CA,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
}

async function safeFetch(url: string, extraHeaders?: Record<string, string>) {
  const res = await fetch(url, {
    headers: { ...BROWSER_HEADERS, ...extraHeaders },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─── HOME DEPOT ──────────────────────────────────────────────────────────────

async function hdStores(postal: string): Promise<StoreLocation[]> {
  const data = await safeFetch(
    `https://www.homedepot.ca/api/2.0/storelocator/store?postalCode=${postal}&maxResults=3`,
    { Referer: 'https://www.homedepot.ca/' }
  )
  return ((data.stores ?? data) as Record<string, unknown>[]).slice(0, 3).map(s => ({
    storeNo: String(s.storeNumber ?? s.storeNo ?? s.id ?? ''),
    name: String(s.storeName ?? s.name ?? 'Home Depot'),
    address: String(s.address ?? ''), city: String(s.city ?? ''),
    province: String(s.province ?? ''), postalCode: String(s.postalCode ?? ''),
    distance: typeof s.distance === 'number' ? s.distance : undefined,
  }))
}

async function hdItems(store: StoreLocation): Promise<ClearanceItem[]> {
  const data = await safeFetch(
    `https://www.homedepot.ca/api/2.0/page/search?pageType=search&q=clearance&store=${store.storeNo}&pageSize=48&sortBy=7`,
    { Referer: 'https://www.homedepot.ca/en/home/special-buys/clearance.html' }
  )
  const products = ((data.searchReport?.products ?? data.products ?? data.results ?? []) as Record<string, unknown>[])
  return products.flatMap(p => {
    const pr = (p.pricing as Record<string, unknown>) ?? {}
    const orig = Number(pr.wasPrice ?? pr.originalPrice ?? pr.regularPrice ?? 0)
    const curr = Number(pr.specialPrice ?? pr.currentPrice ?? pr.nowPrice ?? pr.price ?? 0)
    if (!curr) return []
    return [{ id: `hd-${store.storeNo}-${p.productId ?? p.sku}`, storeId: 'homedepot' as const, storeLocation: store,
      name: String(p.description ?? p.name ?? ''), brand: String(p.brandName ?? ''), sku: String(p.productId ?? p.itemId ?? p.sku ?? ''),
      originalPrice: orig || curr, clearancePrice: curr, discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: p.imageUrl ? String(p.imageUrl) : undefined, productUrl: p.productUrl ? `https://www.homedepot.ca${p.productUrl}` : undefined,
      inStock: p.inventory !== 0, isPenny: curr <= 0.01, category: String(p.category ?? '') }]
  })
}

// ─── WALMART ─────────────────────────────────────────────────────────────────

async function wmStores(postal: string): Promise<StoreLocation[]> {
  const data = await safeFetch(
    `https://www.walmart.ca/api/2.0/stores/nearBySearch?seeAllStores=false&postalCode=${postal}&storeType=WALMART`,
    { Referer: 'https://www.walmart.ca/', 'x-o-bu': 'WALMART-CA', 'x-o-mart': 'B2C', 'x-o-vertical': 'GROCERY' }
  )
  const stores = ((data.stores ?? data.nearestStores ?? data.payload?.stores ?? data) as Record<string, unknown>[])
  return stores.slice(0, 3).map(s => {
    const addr = (s.address ?? {}) as Record<string, unknown>
    return { storeNo: String(s.storeId ?? s.id ?? ''), name: String(s.displayName ?? s.name ?? 'Walmart'),
      address: String(addr.streetAddress ?? ''), city: String(addr.city ?? s.city ?? ''),
      province: String(addr.province ?? s.province ?? ''), postalCode: String(addr.postalCode ?? s.postalCode ?? ''),
      distance: typeof s.distance === 'number' ? s.distance : undefined }
  })
}

async function wmItems(store: StoreLocation): Promise<ClearanceItem[]> {
  const data = await safeFetch(
    `https://www.walmart.ca/api/2.0/page/search?q=clearance&c=0&facet=deal_type%3ANA%3ANA%3AClearance%3ANA%3ANA&storeId=${store.storeNo}&pageSize=48`,
    { Referer: 'https://www.walmart.ca/', 'x-o-bu': 'WALMART-CA', 'x-o-mart': 'B2C' }
  )
  const products = ((data.items ?? data.products ?? data.results ?? []) as Record<string, unknown>[])
  return products.flatMap(p => {
    const pi = (p.priceInfo as Record<string, unknown>) ?? {}
    const orig = Number(pi.wasPrice ?? pi.listPrice ?? pi.regularPrice ?? 0)
    const curr = Number(pi.currentPrice ?? pi.salePrice ?? p.salePrice ?? p.price ?? 0)
    if (!curr) return []
    const imgs = Array.isArray(p.images) ? (p.images as Record<string, unknown>[]) : []
    return [{ id: `wm-${store.storeNo}-${p.itemId ?? p.id}`, storeId: 'walmart' as const, storeLocation: store,
      name: String(p.name ?? p.description ?? ''), brand: String(p.brand ?? ''), sku: String(p.itemId ?? p.id ?? ''),
      originalPrice: orig || curr, clearancePrice: curr, discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: imgs[0]?.url ? String(imgs[0].url) : undefined, productUrl: p.canonicalUrl ? `https://www.walmart.ca${p.canonicalUrl}` : undefined,
      inStock: p.availabilityStatus !== 'OUT_OF_STOCK', isPenny: curr <= 0.01, category: String(p.category ?? '') }]
  })
}

// ─── CANADIAN TIRE ────────────────────────────────────────────────────────────

async function ctStores(postal: string): Promise<StoreLocation[]> {
  const data = await safeFetch(
    `https://api.canadiantire.ca/store/api/v1/stores/?postalCode=${postal}&radius=50&maxCount=3&lang=en`,
    { Referer: 'https://www.canadiantire.ca/', baseSiteId: 'CTR', Host: 'api.canadiantire.ca' }
  )
  const stores = ((data.stores ?? data) as Record<string, unknown>[])
  return stores.slice(0, 3).map(s => {
    const addr = (s.address ?? {}) as Record<string, unknown>
    const region = (addr.region ?? {}) as Record<string, unknown>
    return { storeNo: String(s.storeNumber ?? s.id ?? ''), name: String(s.displayName ?? s.name ?? 'Canadian Tire'),
      address: String(addr.line1 ?? ''), city: String(addr.town ?? s.city ?? ''),
      province: String(region.isocode ?? s.province ?? ''), postalCode: String(addr.postalCode ?? s.postalCode ?? ''),
      distance: typeof s.distance === 'number' ? s.distance : undefined }
  })
}

async function ctItems(store: StoreLocation): Promise<ClearanceItem[]> {
  const data = await safeFetch(
    `https://api.canadiantire.ca/search/api/v0/product/search/?q=clearance&store=${store.storeNo}&lang=en_CA&pageSize=48&currentPage=0&sortBy=relevance&fields=FULL`,
    { Referer: 'https://www.canadiantire.ca/', baseSiteId: 'CTR', Host: 'api.canadiantire.ca' }
  )
  const products = ((data.products ?? data.results ?? []) as Record<string, unknown>[])
  return products.flatMap(p => {
    const price = (p.price as Record<string, unknown>) ?? {}
    const wasPrice = (price.wasPrice as Record<string, unknown>) ?? {}
    const orig = Number(wasPrice.value ?? price.formattedWasPrice ?? price.regularPrice ?? 0)
    const curr = Number(price.value ?? price.currentPrice ?? 0)
    if (!curr) return []
    const imgs = Array.isArray(p.images) ? (p.images as Record<string, unknown>[]) : []
    const firstImg = (imgs[0] ?? {}) as Record<string, unknown>
    const brand = (p.brand as Record<string, unknown>) ?? {}
    const cats = Array.isArray(p.categories) ? (p.categories as Record<string, unknown>[]) : []
    const firstCat = (cats[0] ?? {}) as Record<string, unknown>
    const stock = (p.stock as Record<string, unknown>) ?? {}
    return [{ id: `ct-${store.storeNo}-${p.code ?? p.sku}`, storeId: 'canadiantire' as const, storeLocation: store,
      name: String(p.name ?? ''), brand: String(brand.name ?? p.brandName ?? ''), sku: String(p.code ?? p.sku ?? ''),
      originalPrice: orig || curr, clearancePrice: curr, discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: firstImg.url ? `https://cdn.canadiantire.ca${firstImg.url}` : undefined,
      productUrl: p.url ? `https://www.canadiantire.ca${p.url}` : undefined,
      inStock: stock.stockLevelStatus !== 'outOfStock', isPenny: curr <= 0.01, category: String(firstCat.name ?? '') }]
  })
}

// ─── BEST BUY ─────────────────────────────────────────────────────────────────

async function bbStores(postal: string): Promise<StoreLocation[]> {
  // Try multiple known endpoint patterns
  const urls = [
    `https://www.bestbuy.ca/api/2.0/stores/bypostalcode?postalCode=${postal}&radius=50&lang=en&currentRegion=CA`,
    `https://www.bestbuy.ca/api/2.0/stores?postalCode=${postal}&maxResults=3&currentRegion=CA&lang=en`,
    `https://www.bestbuy.ca/api/2.0/page/stores?postalCode=${postal}&currentRegion=CA`,
  ]
  let data: Record<string, unknown> = {}
  for (const url of urls) {
    try {
      data = await safeFetch(url, { Referer: 'https://www.bestbuy.ca/' }) as Record<string, unknown>
      break
    } catch { continue }
  }
  const stores = ((data.stores ?? data.locations ?? data.results ?? data) as Record<string, unknown>[])
  if (!Array.isArray(stores)) return []
  return stores.slice(0, 3).map(s => ({
    storeNo: String(s.id ?? s.storeId ?? s.locationId ?? ''), name: String(s.name ?? s.displayName ?? 'Best Buy'),
    address: String(s.address ?? s.streetAddress ?? ''), city: String(s.city ?? ''),
    province: String(s.province ?? s.region ?? ''), postalCode: String(s.postalCode ?? s.zip ?? ''),
    distance: typeof s.distance === 'number' ? s.distance : undefined,
  }))
}

async function bbItems(store: StoreLocation): Promise<ClearanceItem[]> {
  const data = await safeFetch(
    `https://www.bestbuy.ca/api/2.0/page/search?currentRegion=CA&query=clearance&store=${store.storeNo}&pageSize=48&sortBy=priceLowToHigh&lang=en-CA`,
    { Referer: 'https://www.bestbuy.ca/', 'x-client-id': 'bestbuy' }
  )
  const products = ((data.products ?? data.results ?? data.items ?? []) as Record<string, unknown>[])
  return products.flatMap(p => {
    const curr = Number(p.salePrice ?? p.lowPrice ?? p.currentPrice ?? 0)
    const orig = Number(p.regularPrice ?? p.originalPrice ?? 0)
    if (!curr) return []
    return [{ id: `bb-${store.storeNo}-${p.sku ?? p.id}`, storeId: 'bestbuy' as const, storeLocation: store,
      name: String(p.name ?? p.shortDescription ?? ''), brand: String(p.brandName ?? ''), sku: String(p.sku ?? p.id ?? ''),
      originalPrice: orig || curr, clearancePrice: curr, discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: p.thumbnailImage ? String(p.thumbnailImage) : undefined,
      productUrl: p.productUrl ? `https://www.bestbuy.ca${p.productUrl}` : undefined,
      inStock: p.availability !== 'SoldOut', isPenny: curr <= 0.01, category: String(p.categoryPath ?? '') }]
  })
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

const SCRAPERS: Record<StoreId, {
  label: string
  stores: (p: string) => Promise<StoreLocation[]>
  items: (s: StoreLocation) => Promise<ClearanceItem[]>
}> = {
  homedepot: { label: 'Home Depot', stores: hdStores, items: hdItems },
  walmart: { label: 'Walmart', stores: wmStores, items: wmItems },
  canadiantire: { label: 'Canadian Tire', stores: ctStores, items: ctItems },
  bestbuy: { label: 'Best Buy', stores: bbStores, items: bbItems },
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const postal = searchParams.get('postal')?.replace(/\s/g, '').toUpperCase()
  const storesParam = searchParams.get('stores') ?? 'homedepot,walmart,canadiantire,bestbuy'
  const minDiscount = parseInt(searchParams.get('minDiscount') ?? '0', 10)

  if (!postal || postal.length < 6) {
    return NextResponse.json({ error: 'postal required' }, { status: 400 })
  }

  const storeIds = storesParam.split(',').filter((s): s is StoreId => s in SCRAPERS)

  const results: StoreResult[] = await Promise.all(
    storeIds.map(async (storeId): Promise<StoreResult> => {
      const sc = SCRAPERS[storeId]
      try {
        const stores = await sc.stores(postal)
        if (!stores.length) return { storeId, storeName: sc.label, items: [], error: 'No stores found near that postal code' }
        const allItems = await sc.items(stores[0])
        const items = allItems.filter(i => i.discountPercent >= minDiscount).sort((a, b) => b.discountPercent - a.discountPercent)
        return { storeId, storeName: sc.label, items }
      } catch (err) {
        return { storeId, storeName: sc.label, items: [], error: err instanceof Error ? err.message : String(err) }
      }
    })
  )

  return NextResponse.json({ results })
}
