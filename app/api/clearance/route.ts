import { NextRequest, NextResponse } from 'next/server'
import type { StoreId, StoreLocation, ClearanceItem } from '@/lib/types'

export const runtime = 'edge'

const PROVINCE_MAP: Record<string, string> = {
  A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC',
  K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON',
  R: 'MB', S: 'SK', T: 'AB', V: 'BC', X: 'NT', Y: 'YT',
}

function proxied(url: string, render = false) {
  const key = process.env.SCRAPER_API_KEY
  if (!key) return url
  return `https://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(url)}&render=${render}&country_code=ca`
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(proxied(url, false), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-CA,en;q=0.9',
    },
    signal: AbortSignal.timeout(18000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// Extract Next.js embedded page data
function extractNextData(html: string): Record<string, unknown> | null {
  const marker = '__NEXT_DATA__'
  const start = html.indexOf(marker)
  if (start === -1) return null
  const jsonStart = html.indexOf('>', start) + 1
  const jsonEnd = html.indexOf('</script>', jsonStart)
  if (jsonStart <= 0 || jsonEnd <= 0) return null
  try { return JSON.parse(html.slice(jsonStart, jsonEnd)) as Record<string, unknown> } catch { return null }
}

// Recursively search nested objects for an array matching given key names
function findByKeys(obj: unknown, keys: string[], depth = 0): unknown[] | null {
  if (depth > 8 || obj == null || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = findByKeys(item, keys, depth + 1)
      if (r) return r
    }
    return null
  }
  const o = obj as Record<string, unknown>
  for (const k of keys) {
    if (k in o && Array.isArray(o[k]) && (o[k] as unknown[]).length > 0) return o[k] as unknown[]
  }
  for (const v of Object.values(o)) {
    const r = findByKeys(v, keys, depth + 1)
    if (r) return r
  }
  return null
}

function fakeStore(storeId: StoreId, label: string, province: string): StoreLocation {
  return { storeNo: '0', name: `${label} (${province})`, address: '', city: '', province, postalCode: '' }
}

// ─── HOME DEPOT ──────────────────────────────────────────────────────────────
async function hdClearance(province: string): Promise<ClearanceItem[]> {
  const store = fakeStore('homedepot', 'Home Depot', province)
  const html = await fetchHtml('https://www.homedepot.ca/en/home/special-buys/clearance.html')
  const nd = extractNextData(html)
  const products = (findByKeys(nd, ['products', 'items', 'results', 'skus']) ?? []) as Record<string, unknown>[]
  if (!products.length) throw new Error('No product data in page')
  return products.flatMap(p => {
    const pr = (p.pricing as Record<string, unknown>) ?? (p.price as Record<string, unknown>) ?? {}
    const orig = Number(pr.wasPrice ?? pr.originalPrice ?? pr.regularPrice ?? p.wasPrice ?? 0)
    const curr = Number(pr.specialPrice ?? pr.currentPrice ?? pr.price ?? p.currentPrice ?? p.price ?? 0)
    if (!curr) return []
    return [{ id: `hd-${p.productId ?? p.sku ?? p.id}`, storeId: 'homedepot' as const, storeLocation: store,
      name: String(p.description ?? p.name ?? p.title ?? ''), brand: String(p.brandName ?? p.brand ?? ''),
      sku: String(p.productId ?? p.itemId ?? p.sku ?? ''),
      originalPrice: orig || curr, clearancePrice: curr,
      discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: p.imageUrl ? String(p.imageUrl) : undefined,
      productUrl: p.productUrl ? `https://www.homedepot.ca${p.productUrl}` : p.url ? `https://www.homedepot.ca${p.url}` : undefined,
      inStock: true, isPenny: curr <= 0.01, category: String(p.category ?? p.categoryName ?? '') }]
  })
}

// ─── WALMART ─────────────────────────────────────────────────────────────────
async function wmClearance(province: string): Promise<ClearanceItem[]> {
  const store = fakeStore('walmart', 'Walmart', province)
  const html = await fetchHtml('https://www.walmart.ca/en/clearance')
  const nd = extractNextData(html)
  const products = (findByKeys(nd, ['items', 'products', 'itemStacks', 'results', 'skus']) ?? []) as Record<string, unknown>[]
  if (!products.length) throw new Error('No product data in page')
  return products.flatMap(p => {
    const pi = (p.priceInfo as Record<string, unknown>) ?? (p.price as Record<string, unknown>) ?? {}
    const orig = Number(pi.wasPrice ?? pi.listPrice ?? pi.regularPrice ?? p.wasPrice ?? 0)
    const curr = Number(pi.currentPrice ?? pi.salePrice ?? p.currentPrice ?? p.salePrice ?? p.price ?? 0)
    if (!curr) return []
    const imgs = Array.isArray(p.imageInfo) ? p.imageInfo as Record<string, unknown>[] : []
    const imgUrl = (p.imageInfo as Record<string, unknown>)?.thumbnailUrl ?? imgs[0]?.url ?? p.image ?? p.imageUrl
    return [{ id: `wm-${p.itemId ?? p.id ?? p.sku}`, storeId: 'walmart' as const, storeLocation: store,
      name: String(p.name ?? p.description ?? ''), brand: String(p.brand ?? p.brandName ?? ''),
      sku: String(p.itemId ?? p.id ?? p.sku ?? ''),
      originalPrice: orig || curr, clearancePrice: curr,
      discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: imgUrl ? String(imgUrl) : undefined,
      productUrl: p.canonicalUrl ? `https://www.walmart.ca${p.canonicalUrl}` : undefined,
      inStock: p.availabilityStatus !== 'OUT_OF_STOCK', isPenny: curr <= 0.01, category: String(p.category ?? p.categoryPath ?? '') }]
  })
}

// ─── CANADIAN TIRE ────────────────────────────────────────────────────────────
async function ctClearance(province: string): Promise<ClearanceItem[]> {
  const store = fakeStore('canadiantire', 'Canadian Tire', province)
  const html = await fetchHtml('https://www.canadiantire.ca/en/clearance.html')
  const nd = extractNextData(html)
  const products = (findByKeys(nd, ['products', 'items', 'results', 'catalogItems']) ?? []) as Record<string, unknown>[]
  if (!products.length) throw new Error('No product data in page')
  return products.flatMap(p => {
    const price = (p.price as Record<string, unknown>) ?? {}
    const wasPrice = (price.wasPrice as Record<string, unknown>) ?? {}
    const orig = Number(wasPrice.value ?? price.wasPrice ?? p.wasPrice ?? 0)
    const curr = Number(price.value ?? price.currentPrice ?? p.currentPrice ?? p.price ?? 0)
    if (!curr) return []
    const imgs = Array.isArray(p.images) ? (p.images as Record<string, unknown>[]) : []
    const firstImg = (imgs[0] ?? {}) as Record<string, unknown>
    const brand = (p.brand as Record<string, unknown>) ?? {}
    const cats = Array.isArray(p.categories) ? (p.categories as Record<string, unknown>[]) : []
    const firstCat = (cats[0] ?? {}) as Record<string, unknown>
    return [{ id: `ct-${p.code ?? p.sku ?? p.id}`, storeId: 'canadiantire' as const, storeLocation: store,
      name: String(p.name ?? p.description ?? ''), brand: String(brand.name ?? p.brandName ?? ''),
      sku: String(p.code ?? p.sku ?? ''),
      originalPrice: orig || curr, clearancePrice: curr,
      discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: firstImg.url ? `https://cdn.canadiantire.ca${firstImg.url}` : p.imageUrl ? String(p.imageUrl) : undefined,
      productUrl: p.url ? `https://www.canadiantire.ca${p.url}` : undefined,
      inStock: true, isPenny: curr <= 0.01, category: String(firstCat.name ?? p.category ?? '') }]
  })
}

// ─── BEST BUY ─────────────────────────────────────────────────────────────────
async function bbClearance(province: string): Promise<ClearanceItem[]> {
  const store = fakeStore('bestbuy', 'Best Buy', province)
  const html = await fetchHtml('https://www.bestbuy.ca/en-ca/clearance')
  const nd = extractNextData(html)
  const products = (findByKeys(nd, ['products', 'items', 'results', 'catalogItems', 'entities']) ?? []) as Record<string, unknown>[]
  if (!products.length) throw new Error('No product data in page')
  return products.flatMap(p => {
    const curr = Number(p.salePrice ?? p.lowPrice ?? p.currentPrice ?? p.price ?? 0)
    const orig = Number(p.regularPrice ?? p.originalPrice ?? p.wasPrice ?? 0)
    if (!curr) return []
    return [{ id: `bb-${p.sku ?? p.id}`, storeId: 'bestbuy' as const, storeLocation: store,
      name: String(p.name ?? p.shortDescription ?? p.description ?? ''), brand: String(p.brandName ?? p.brand ?? ''),
      sku: String(p.sku ?? p.id ?? ''),
      originalPrice: orig || curr, clearancePrice: curr,
      discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: p.thumbnailImage ? String(p.thumbnailImage) : p.image ? String(p.image) : undefined,
      productUrl: p.productUrl ? `https://www.bestbuy.ca${p.productUrl}` : undefined,
      inStock: p.availability !== 'SoldOut', isPenny: curr <= 0.01, category: String(p.categoryPath ?? p.category ?? '') }]
  })
}

const SCRAPERS: Record<StoreId, { label: string; fn: (p: string) => Promise<ClearanceItem[]> }> = {
  homedepot: { label: 'Home Depot', fn: hdClearance },
  walmart: { label: 'Walmart', fn: wmClearance },
  canadiantire: { label: 'Canadian Tire', fn: ctClearance },
  bestbuy: { label: 'Best Buy', fn: bbClearance },
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const postal = searchParams.get('postal')?.replace(/\s/g, '').toUpperCase() ?? ''
  const storeId = searchParams.get('store') as StoreId | null
  const minDiscount = parseInt(searchParams.get('minDiscount') ?? '0', 10)

  if (!storeId || !(storeId in SCRAPERS)) return NextResponse.json({ error: 'invalid store' }, { status: 400 })
  if (postal.length < 3) return NextResponse.json({ error: 'postal required' }, { status: 400 })

  const province = PROVINCE_MAP[postal[0]] ?? 'CA'
  const sc = SCRAPERS[storeId]

  try {
    const allItems = await sc.fn(province)
    const items = allItems.filter(i => i.discountPercent >= minDiscount).sort((a, b) => b.discountPercent - a.discountPercent)
    return NextResponse.json({ storeId, items })
  } catch (err) {
    return NextResponse.json({ storeId, items: [], error: err instanceof Error ? err.message : String(err) })
  }
}
