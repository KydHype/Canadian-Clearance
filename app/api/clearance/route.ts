import { NextRequest, NextResponse } from 'next/server'
import type { StoreId, StoreResult, StoreLocation, ClearanceItem } from '@/lib/types'

export const runtime = 'edge'

// Province from first letter of postal code
const PROVINCE_MAP: Record<string, string> = {
  A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC',
  K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON',
  R: 'MB', S: 'SK', T: 'AB', V: 'BC', X: 'NT', Y: 'YT',
}

function getProvince(postal: string) {
  return PROVINCE_MAP[postal[0].toUpperCase()] ?? 'CA'
}

function proxied(url: string) {
  const key = process.env.SCRAPER_API_KEY
  if (!key) return url
  return `https://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(url)}&render=false`
}

async function safeFetch(url: string, headers?: Record<string, string>) {
  const res = await fetch(proxied(url), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-CA,en;q=0.9',
      'Referer': 'https://www.google.ca/',
      ...headers,
    },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// Fake store location — we skip store locator and search nationally,
// noting the user's province from their postal code
function regionStore(storeId: StoreId, label: string, province: string): StoreLocation {
  return { storeNo: '0', name: `${label} (${province} region)`, address: '', city: '', province, postalCode: '' }
}

// ─── HOME DEPOT ──────────────────────────────────────────────────────────────
async function hdClearance(province: string): Promise<ClearanceItem[]> {
  const store = regionStore('homedepot', 'Home Depot', province)
  const data = await safeFetch(
    `https://www.homedepot.ca/api/2.0/page/search?pageType=search&q=clearance&pageSize=48&sortBy=7&lang=en`,
    { Referer: 'https://www.homedepot.ca/en/home/special-buys/clearance.html' }
  )
  const products = (data.searchReport?.products ?? data.products ?? data.results ?? []) as Record<string, unknown>[]
  return products.flatMap(p => {
    const pr = (p.pricing as Record<string, unknown>) ?? {}
    const orig = Number(pr.wasPrice ?? pr.originalPrice ?? pr.regularPrice ?? 0)
    const curr = Number(pr.specialPrice ?? pr.currentPrice ?? pr.nowPrice ?? pr.price ?? 0)
    if (!curr) return []
    return [{ id: `hd-${p.productId ?? p.sku}`, storeId: 'homedepot' as const, storeLocation: store,
      name: String(p.description ?? p.name ?? ''), brand: String(p.brandName ?? ''),
      sku: String(p.productId ?? p.itemId ?? p.sku ?? ''),
      originalPrice: orig || curr, clearancePrice: curr,
      discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: p.imageUrl ? String(p.imageUrl) : undefined,
      productUrl: p.productUrl ? `https://www.homedepot.ca${p.productUrl}` : undefined,
      inStock: p.inventory !== 0, isPenny: curr <= 0.01, category: String(p.category ?? '') }]
  })
}

// ─── WALMART ─────────────────────────────────────────────────────────────────
async function wmClearance(province: string): Promise<ClearanceItem[]> {
  const store = regionStore('walmart', 'Walmart', province)
  const data = await safeFetch(
    `https://www.walmart.ca/api/2.0/page/search?q=clearance&c=0&facet=deal_type%3ANA%3ANA%3AClearance%3ANA%3ANA&pageSize=48`,
    { Referer: 'https://www.walmart.ca/', 'x-o-bu': 'WALMART-CA', 'x-o-mart': 'B2C' }
  )
  const products = (data.items ?? data.products ?? data.results ?? []) as Record<string, unknown>[]
  return products.flatMap(p => {
    const pi = (p.priceInfo as Record<string, unknown>) ?? {}
    const orig = Number(pi.wasPrice ?? pi.listPrice ?? pi.regularPrice ?? 0)
    const curr = Number(pi.currentPrice ?? pi.salePrice ?? p.salePrice ?? p.price ?? 0)
    if (!curr) return []
    const imgs = Array.isArray(p.images) ? (p.images as Record<string, unknown>[]) : []
    return [{ id: `wm-${p.itemId ?? p.id}`, storeId: 'walmart' as const, storeLocation: store,
      name: String(p.name ?? p.description ?? ''), brand: String(p.brand ?? ''),
      sku: String(p.itemId ?? p.id ?? ''),
      originalPrice: orig || curr, clearancePrice: curr,
      discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: imgs[0]?.url ? String((imgs[0] as Record<string, unknown>).url) : undefined,
      productUrl: p.canonicalUrl ? `https://www.walmart.ca${p.canonicalUrl}` : undefined,
      inStock: p.availabilityStatus !== 'OUT_OF_STOCK', isPenny: curr <= 0.01, category: String(p.category ?? '') }]
  })
}

// ─── CANADIAN TIRE ────────────────────────────────────────────────────────────
async function ctClearance(province: string): Promise<ClearanceItem[]> {
  const store = regionStore('canadiantire', 'Canadian Tire', province)
  const data = await safeFetch(
    `https://api.canadiantire.ca/search/api/v0/product/search/?q=clearance&pageSize=48&lang=en_CA&fields=FULL&sortBy=relevance`,
    { Referer: 'https://www.canadiantire.ca/', baseSiteId: 'CTR', Host: 'api.canadiantire.ca' }
  )
  const products = (data.products ?? data.results ?? []) as Record<string, unknown>[]
  return products.flatMap(p => {
    const price = (p.price as Record<string, unknown>) ?? {}
    const wasPrice = (price.wasPrice as Record<string, unknown>) ?? {}
    const orig = Number(wasPrice.value ?? price.formattedWasPrice ?? 0)
    const curr = Number(price.value ?? price.currentPrice ?? 0)
    if (!curr) return []
    const imgs = Array.isArray(p.images) ? (p.images as Record<string, unknown>[]) : []
    const firstImg = (imgs[0] ?? {}) as Record<string, unknown>
    const brand = (p.brand as Record<string, unknown>) ?? {}
    const cats = Array.isArray(p.categories) ? (p.categories as Record<string, unknown>[]) : []
    const firstCat = (cats[0] ?? {}) as Record<string, unknown>
    return [{ id: `ct-${p.code ?? p.sku}`, storeId: 'canadiantire' as const, storeLocation: store,
      name: String(p.name ?? ''), brand: String(brand.name ?? p.brandName ?? ''),
      sku: String(p.code ?? p.sku ?? ''),
      originalPrice: orig || curr, clearancePrice: curr,
      discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: firstImg.url ? `https://cdn.canadiantire.ca${firstImg.url}` : undefined,
      productUrl: p.url ? `https://www.canadiantire.ca${p.url}` : undefined,
      inStock: (p.stock as Record<string, unknown>)?.stockLevelStatus !== 'outOfStock',
      isPenny: curr <= 0.01, category: String(firstCat.name ?? '') }]
  })
}

// ─── BEST BUY ─────────────────────────────────────────────────────────────────
async function bbClearance(province: string): Promise<ClearanceItem[]> {
  const store = regionStore('bestbuy', 'Best Buy', province)
  const data = await safeFetch(
    `https://www.bestbuy.ca/api/2.0/page/search?currentRegion=CA&query=clearance&pageSize=48&sortBy=priceLowToHigh&lang=en-CA`,
    { Referer: 'https://www.bestbuy.ca/' }
  )
  const products = (data.products ?? data.results ?? data.items ?? []) as Record<string, unknown>[]
  return products.flatMap(p => {
    const curr = Number(p.salePrice ?? p.lowPrice ?? p.currentPrice ?? 0)
    const orig = Number(p.regularPrice ?? p.originalPrice ?? 0)
    if (!curr) return []
    return [{ id: `bb-${p.sku ?? p.id}`, storeId: 'bestbuy' as const, storeLocation: store,
      name: String(p.name ?? p.shortDescription ?? ''), brand: String(p.brandName ?? ''),
      sku: String(p.sku ?? p.id ?? ''),
      originalPrice: orig || curr, clearancePrice: curr,
      discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: p.thumbnailImage ? String(p.thumbnailImage) : undefined,
      productUrl: p.productUrl ? `https://www.bestbuy.ca${p.productUrl}` : undefined,
      inStock: p.availability !== 'SoldOut', isPenny: curr <= 0.01, category: String(p.categoryPath ?? '') }]
  })
}

// ─── SCRAPERS MAP ─────────────────────────────────────────────────────────────
const SCRAPERS: Record<StoreId, { label: string; fn: (province: string) => Promise<ClearanceItem[]> }> = {
  homedepot: { label: 'Home Depot', fn: hdClearance },
  walmart: { label: 'Walmart', fn: wmClearance },
  canadiantire: { label: 'Canadian Tire', fn: ctClearance },
  bestbuy: { label: 'Best Buy', fn: bbClearance },
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const postal = searchParams.get('postal')?.replace(/\s/g, '').toUpperCase() ?? ''
  const storesParam = searchParams.get('stores') ?? 'homedepot,walmart,canadiantire,bestbuy'
  const minDiscount = parseInt(searchParams.get('minDiscount') ?? '0', 10)

  if (postal.length < 3) return NextResponse.json({ error: 'postal required' }, { status: 400 })

  const province = getProvince(postal)
  const storeIds = storesParam.split(',').filter((s): s is StoreId => s in SCRAPERS)
  const results: StoreResult[] = []

  // Run sequentially — ScraperAPI free plan allows only 1 concurrent request
  for (const storeId of storeIds) {
    const sc = SCRAPERS[storeId]
    try {
      const allItems = await sc.fn(province)
      const items = allItems
        .filter(i => i.discountPercent >= minDiscount)
        .sort((a, b) => b.discountPercent - a.discountPercent)
      results.push({ storeId, storeName: sc.label, items })
    } catch (err) {
      results.push({ storeId, storeName: sc.label, items: [], error: err instanceof Error ? err.message : String(err) })
    }
    if (storeIds.indexOf(storeId) < storeIds.length - 1) await delay(400)
  }

  return NextResponse.json({ results })
}
