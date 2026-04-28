import { NextRequest, NextResponse } from 'next/server'
import type { StoreId, StoreLocation, ClearanceItem } from '@/lib/types'

// Node.js serverless runtime — 60s max, needed for render=true (JS execution via ScraperAPI)
export const maxDuration = 60

const PROVINCE_MAP: Record<string, string> = {
  A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC',
  K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON',
  R: 'MB', S: 'SK', T: 'AB', V: 'BC', X: 'NT', Y: 'YT',
}

function proxied(url: string, render = true, wait = 3000) {
  const key = process.env.SCRAPER_API_KEY
  if (!key) return url
  const params = `api_key=${key}&url=${encodeURIComponent(url)}&country_code=ca&device_type=desktop`
  return render
    ? `https://api.scraperapi.com?${params}&render=true&wait=${wait}`
    : `https://api.scraperapi.com?${params}`
}

async function fetchHtml(url: string, render = true, wait = 3000): Promise<string> {
  const res = await fetch(proxied(url, render, wait), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
      'Accept-Language': 'en-CA,en;q=0.9',
    },
    signal: AbortSignal.timeout(50000),
  })
  if (!res.ok) {
    const preview = await res.text().then(t =>
      t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 250)
    ).catch(() => '')
    throw new Error(`HTTP ${res.status}${preview ? ` — ${preview}` : ''}`)
  }
  return res.text()
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(proxied(url, false), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, */*',
      'Accept-Language': 'en-CA,en;q=0.9',
    },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`API HTTP ${res.status}`)
  return res.json()
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

// Extract all inline JSON blobs from <script> tags (catches window.__STATE__ etc.)
function extractInlineJsonBlobs(html: string): unknown[] {
  const blobs: unknown[] = []
  const re = /<script[^>]*>\s*([\[{][\s\S]*?)\s*<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try { blobs.push(JSON.parse(m[1])) } catch { /* ignore */ }
  }
  return blobs
}

// Recursively search nested objects for an array matching given key names
function findByKeys(obj: unknown, keys: string[], depth = 0): unknown[] | null {
  if (depth > 10 || obj == null || typeof obj !== 'object') return null
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

// Try all data sources in the HTML to find a product array
function extractProducts(html: string, keys: string[]): Record<string, unknown>[] {
  // 1. __NEXT_DATA__ (Next.js SSR)
  const nd = extractNextData(html)
  if (nd) {
    const found = findByKeys(nd, keys)
    if (found?.length) return found as Record<string, unknown>[]
  }
  // 2. Any other inline JSON blobs (window.__STATE__, apollo cache, etc.)
  for (const blob of extractInlineJsonBlobs(html)) {
    const found = findByKeys(blob, keys)
    if (found?.length) return found as Record<string, unknown>[]
  }
  return []
}

function fakeStore(storeId: StoreId, label: string, province: string): StoreLocation {
  return { storeNo: '0', name: `${label} (${province})`, address: '', city: '', province, postalCode: '' }
}

// ─── HOME DEPOT ──────────────────────────────────────────────────────────────
async function hdClearance(province: string): Promise<ClearanceItem[]> {
  const store = fakeStore('homedepot', 'Home Depot', province)
  // HD's clearance page loads products via client-side API call.
  // Call that JSON API directly — much faster than render=true on the HTML page.
  const json = await fetchJson(
    'https://www.homedepot.ca/api/2.0/page/category-listing?N=4294967206&Nrpp=48&storeId=7139&catalogId=10051&langId=-1'
  ).catch(() => null)
  let products: Record<string, unknown>[] = []
  if (json) {
    products = (findByKeys(json, ['products', 'items', 'results', 'skus', 'productList', 'catalogItems']) ?? []) as Record<string, unknown>[]
  }
  if (!products.length) {
    // Fallback: scrape the HTML page (render=false is fast, products might be in __NEXT_DATA__)
    const html = await fetchHtml('https://www.homedepot.ca/en/home/special-buys/clearance.html', false)
    products = extractProducts(html, ['products', 'items', 'results', 'skus', 'productList', 'catalogItems', 'data'])
  }
  if (!products.length) throw new Error('No product data in page — HD structure may have changed')
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
  // /en/clearance is a 404 — walmart.ca uses faceted search for clearance items
  const html = await fetchHtml('https://www.walmart.ca/search?facets%5B%5D=specialOffer%3AClearance', true, 3000)
  const products = extractProducts(html, ['items', 'products', 'itemStacks', 'results', 'skus', 'nodes', 'edges', 'searchResult'])
  if (!products.length) throw new Error('No product data in page — store may have changed its structure')
  return products.flatMap(p => {
    const node = (p.node as Record<string, unknown>) ?? p
    const pi = (node.priceInfo as Record<string, unknown>) ?? (node.price as Record<string, unknown>) ?? {}
    const orig = Number(pi.wasPrice ?? pi.listPrice ?? pi.regularPrice ?? node.wasPrice ?? 0)
    const curr = Number(pi.currentPrice ?? pi.salePrice ?? node.currentPrice ?? node.salePrice ?? node.price ?? 0)
    if (!curr) return []
    const imgs = Array.isArray(node.imageInfo) ? node.imageInfo as Record<string, unknown>[] : []
    const imgUrl = (node.imageInfo as Record<string, unknown>)?.thumbnailUrl ?? imgs[0]?.url ?? node.image ?? node.imageUrl
    return [{ id: `wm-${node.itemId ?? node.id ?? node.sku}`, storeId: 'walmart' as const, storeLocation: store,
      name: String(node.name ?? node.description ?? ''), brand: String(node.brand ?? node.brandName ?? ''),
      sku: String(node.itemId ?? node.id ?? node.sku ?? ''),
      originalPrice: orig || curr, clearancePrice: curr,
      discountPercent: orig > curr ? Math.round((1 - curr / orig) * 100) : 0,
      imageUrl: imgUrl ? String(imgUrl) : undefined,
      productUrl: node.canonicalUrl ? `https://www.walmart.ca${node.canonicalUrl}` : undefined,
      inStock: node.availabilityStatus !== 'OUT_OF_STOCK', isPenny: curr <= 0.01, category: String(node.category ?? node.categoryPath ?? '') }]
  })
}

// ─── CANADIAN TIRE ────────────────────────────────────────────────────────────
async function ctClearance(province: string): Promise<ClearanceItem[]> {
  const store = fakeStore('canadiantire', 'Canadian Tire', province)
  // /en/clearance.html is a 404 — try without extension, or their sale/clearance section
  const html = await fetchHtml('https://www.canadiantire.ca/en/clearance', true, 3000)
  const products = extractProducts(html, ['products', 'items', 'results', 'catalogItems', 'productList', 'skus'])
  if (!products.length) throw new Error('No product data in page — store may have changed its structure')
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
  // /en-ca/clearance is a 404 — BB Canada clearance is under /collection/
  const html = await fetchHtml('https://www.bestbuy.ca/en-ca/collection/clearance/cat_clearance', true, 3000)
  const products = extractProducts(html, ['products', 'items', 'results', 'catalogItems', 'entities', 'skus', 'productList'])
  if (!products.length) throw new Error('No product data in page — store may have changed its structure')
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
