import { NextRequest, NextResponse } from 'next/server'
import type { StoreId, StoreLocation, ClearanceItem } from '@/lib/types'

export const maxDuration = 60

const PROVINCE_MAP: Record<string, string> = {
  A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC',
  K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON',
  R: 'MB', S: 'SK', T: 'AB', V: 'BC', X: 'NT', Y: 'YT',
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*;q=0.9',
  'Accept-Language': 'en-CA,en;q=0.9',
}

// Proxy through ScraperAPI — render=false (fast, ~2s), no headless browser
function proxied(url: string) {
  const key = process.env.SCRAPER_API_KEY
  if (!key) return url
  return `https://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(url)}&country_code=ca&device_type=desktop`
}

async function get(url: string, asJson = false): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(proxied(url), {
    headers: { ...HEADERS, Accept: asJson ? 'application/json, */*' : 'text/html, */*;q=0.9' },
    signal: AbortSignal.timeout(25000),
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
}

async function getJson(url: string): Promise<unknown> {
  const r = await get(url, true)
  if (!r.ok) throw new Error(`API HTTP ${r.status} — ${r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)}`)
  try { return JSON.parse(r.text) } catch { throw new Error(`API returned non-JSON (${r.status}): ${r.text.slice(0, 150)}`) }
}

async function getHtml(url: string): Promise<string> {
  const r = await get(url, false)
  if (!r.ok) throw new Error(`HTTP ${r.status} — ${r.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)}`)
  return r.text
}

// Extract Next.js embedded page data
function extractNextData(html: string): Record<string, unknown> | null {
  const start = html.indexOf('__NEXT_DATA__')
  if (start === -1) return null
  const jsonStart = html.indexOf('>', start) + 1
  const jsonEnd = html.indexOf('</script>', jsonStart)
  if (jsonStart <= 0 || jsonEnd <= 0) return null
  try { return JSON.parse(html.slice(jsonStart, jsonEnd)) as Record<string, unknown> } catch { return null }
}

// Recursively search nested objects/arrays for an array matching given key names
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

function extractProducts(html: string, keys: string[]): Record<string, unknown>[] {
  const nd = extractNextData(html)
  if (nd) {
    const found = findByKeys(nd, keys)
    if (found?.length) return found as Record<string, unknown>[]
  }
  // Also scan inline JSON blobs (window.__STATE__ etc.)
  const re = /<script[^>]*>\s*([\[{][\s\S]*?)\s*<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const blob = JSON.parse(m[1])
      const found = findByKeys(blob, keys)
      if (found?.length) return found as Record<string, unknown>[]
    } catch { /* skip */ }
  }
  return []
}

function fakeStore(storeId: StoreId, label: string, province: string): StoreLocation {
  return { storeNo: '0', name: `${label} (${province})`, address: '', city: '', province, postalCode: '' }
}

// ─── HOME DEPOT ──────────────────────────────────────────────────────────────
// HD Canada uses Bloomreach/ATG commerce. Their clearance PLP makes a JSON API
// call to their product catalog. We replicate that call directly.
async function hdClearance(province: string): Promise<ClearanceItem[]> {
  const store = fakeStore('homedepot', 'Home Depot', province)
  // Try their internal product listing API first (fast, render=false JSON)
  // N=4294967206 is the Endeca/Bloomreach root clearance category nav state
  const apiUrls = [
    `https://www.homedepot.ca/api/2.0/page/category-listing?N=4294967206&Nrpp=48&storeId=7139&catalogId=10051&langId=-1`,
    `https://www.homedepot.ca/api/2.0/page/category-listing?q=clearance&Nrpp=48&storeId=7139`,
  ]
  let json: unknown = null
  for (const url of apiUrls) {
    json = await getJson(url).catch(e => { console.error('[HD API]', url, e.message); return null })
    if (json) break
  }
  let products: Record<string, unknown>[] = []
  if (json) {
    products = (findByKeys(json, ['products', 'items', 'results', 'skus', 'productList', 'records', 'Product']) ?? []) as Record<string, unknown>[]
  }
  if (!products.length) {
    // Fallback: parse the HTML clearance page (render=false, products may be in initial HTML)
    const html = await getHtml('https://www.homedepot.ca/en/home/special-buys/clearance.html')
    products = extractProducts(html, ['products', 'items', 'results', 'skus', 'productList', 'records'])
  }
  if (!products.length) throw new Error('No product data — HD API response structure may have changed')
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
// Walmart.ca uses Next.js with SSR. The canonical clearance page URL is
// /en/shop/clearance/6000204800999 and products are nested in
// __NEXT_DATA__.props.pageProps.initialData.searchResult.itemStacks[n].items
async function wmClearance(province: string): Promise<ClearanceItem[]> {
  const store = fakeStore('walmart', 'Walmart', province)
  // The search?q=clearance URL redirects to this canonical clearance category page
  const html = await getHtml('https://www.walmart.ca/en/shop/clearance/6000204800999')
  const nd = extractNextData(html)
  if (!nd) throw new Error('No __NEXT_DATA__ found — Walmart page structure may have changed')

  // Walmart nests products inside itemStacks[n].items — handle that specifically
  let products: Record<string, unknown>[] = []
  const stacks = findByKeys(nd, ['itemStacks']) as Record<string, unknown>[] | null
  if (stacks?.length) {
    for (const stack of stacks) {
      const items = Array.isArray((stack as Record<string, unknown>).items)
        ? (stack as Record<string, unknown>).items as Record<string, unknown>[]
        : []
      products.push(...items)
    }
  }
  if (!products.length) {
    products = (findByKeys(nd, ['items', 'products', 'results']) ?? []) as Record<string, unknown>[]
  }
  if (!products.length) {
    // Expose top-level keys for debugging
    const pp = (nd.props as Record<string, unknown>)
    throw new Error(`No product data in Walmart page. Top-level props keys: ${Object.keys(pp ?? {}).join(', ')}`)
  }
  return products.flatMap(p => {
    const node = (p.node as Record<string, unknown>) ?? p
    const pi = (node.priceInfo as Record<string, unknown>) ?? (node.price as Record<string, unknown>) ?? {}
    const orig = Number(pi.wasPrice ?? pi.listPrice ?? pi.regularPrice ?? node.wasPrice ?? 0)
    const curr = Number(pi.currentPrice ?? pi.salePrice ?? node.currentPrice ?? node.salePrice ?? node.price ?? 0)
    if (!curr) return []
    const imgUrl = (node.imageInfo as Record<string, unknown>)?.thumbnailUrl ?? node.image ?? node.imageUrl
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
// CT uses their own product search API at api.canadiantire.ca — returns JSON directly.
async function ctClearance(province: string): Promise<ClearanceItem[]> {
  const store = fakeStore('canadiantire', 'Canadian Tire', province)
  const apiUrls = [
    `https://api.canadiantire.ca/search/api/v0/search?q=clearance&page=0&pageSize=48&language=en&site=CTR&storeId=0248`,
    `https://api.canadiantire.ca/product-catalog/v1/en/products?q=clearance&page=0&pageSize=48&storeId=0248`,
  ]
  let json: unknown = null
  for (const url of apiUrls) {
    json = await getJson(url).catch(e => { console.error('[CT API]', url, e.message); return null })
    if (json) break
  }
  let products: Record<string, unknown>[] = []
  if (json) {
    products = (findByKeys(json, ['products', 'items', 'results', 'catalogItems', 'skus', 'records']) ?? []) as Record<string, unknown>[]
  }
  if (!products.length) {
    // HTML fallback — try a few known URL patterns for CT's clearance section
    const htmlUrls = [
      'https://www.canadiantire.ca/en/clearance-sale.html',
      'https://www.canadiantire.ca/en/sale-clearance.html',
      'https://www.canadiantire.ca/en/sale.html',
    ]
    for (const url of htmlUrls) {
      const html = await getHtml(url).catch(() => '')
      if (!html) continue
      products = extractProducts(html, ['products', 'items', 'results', 'catalogItems', 'skus'])
      if (products.length) break
    }
  }
  if (!products.length) throw new Error('No product data — CT API/page structure may have changed')
  return products.flatMap(p => {
    const price = (p.price as Record<string, unknown>) ?? {}
    const wasPrice = (price.wasPrice as Record<string, unknown>) ?? {}
    const orig = Number(wasPrice.value ?? price.wasPrice ?? p.wasPrice ?? p.regularPrice ?? 0)
    const curr = Number(price.value ?? price.currentPrice ?? p.currentPrice ?? p.price ?? p.salePrice ?? 0)
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
// BB Canada has a public JSON search API. We filter by clearanceSavings sort
// which naturally surfaces only items with clearance pricing applied.
async function bbClearance(province: string): Promise<ClearanceItem[]> {
  const store = fakeStore('bestbuy', 'Best Buy', province)
  const apiUrls = [
    `https://www.bestbuy.ca/api/2.0/json/search?currentRegion=${province}&locale=en-CA&query=&pageSize=48&sortBy=clearanceSavings&sortDir=desc`,
    `https://www.bestbuy.ca/api/2.0/json/search?currentRegion=ON&locale=en-CA&query=&pageSize=48&sortBy=clearanceSavings&sortDir=desc`,
  ]
  let json: unknown = null
  for (const url of apiUrls) {
    json = await getJson(url).catch(e => { console.error('[BB API]', url, e.message); return null })
    if (json) break
  }
  let products: Record<string, unknown>[] = []
  if (json) {
    products = (findByKeys(json, ['products', 'items', 'results', 'catalogItems', 'entities', 'skus']) ?? []) as Record<string, unknown>[]
  }
  if (!products.length) throw new Error(`No product data — BB API may have changed. Raw: ${JSON.stringify(json)?.slice(0, 200) ?? 'null'}`)
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

  const province = PROVINCE_MAP[postal[0]] ?? 'ON'
  const sc = SCRAPERS[storeId]

  try {
    const allItems = await sc.fn(province)
    const items = allItems.filter(i => i.discountPercent >= minDiscount).sort((a, b) => b.discountPercent - a.discountPercent)
    return NextResponse.json({ storeId, items })
  } catch (err) {
    return NextResponse.json({ storeId, items: [], error: err instanceof Error ? err.message : String(err) })
  }
}
