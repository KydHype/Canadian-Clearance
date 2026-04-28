import { NextResponse } from 'next/server'

export const runtime = 'edge'

function proxied(url: string) {
  const key = process.env.SCRAPER_API_KEY
  if (!key) return url
  return `https://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(url)}&render=false`
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

const TESTS = [
  // Home Depot - try search directly (skip store locator)
  { n: 'HD-search', url: 'https://www.homedepot.ca/api/2.0/page/search?pageType=search&q=clearance&pageSize=5' },
  { n: 'HD-storelocator-v2', url: 'https://www.homedepot.ca/api/2.0/storelocator?postalCode=V1T3A5&maxResults=3' },
  { n: 'HD-stores-nearby', url: 'https://www.homedepot.ca/api/2.0/store/nearby?postalCode=V1T3A5' },
  // Walmart - try search directly + different store locators
  { n: 'WM-search', url: 'https://www.walmart.ca/api/2.0/page/search?q=clearance&facet=deal_type%3ANA%3ANA%3AClearance%3ANA%3ANA&pageSize=5' },
  { n: 'WM-stores-v2', url: 'https://www.walmart.ca/api/2.0/store/nearby?postalCode=V1T3A5' },
  { n: 'WM-stores-v3', url: 'https://www.walmart.ca/api/2.0/stores/location?postalCode=V1T3A5&count=3' },
  // Canadian Tire - www domain (CT-3 returned their own JSON 404, so www.canadiantire.ca/api/ is real)
  { n: 'CT-www-v1', url: 'https://www.canadiantire.ca/api/store/v1/stores/search?postalCode=V1T3A5&radius=100' },
  { n: 'CT-www-v2', url: 'https://www.canadiantire.ca/api/store/v1/stores/byPostalCode?postalCode=V1T3A5&radius=100' },
  { n: 'CT-search', url: 'https://api.canadiantire.ca/search/api/v0/product/search/?q=clearance&pageSize=5&lang=en_CA&fields=FULL' },
  // Best Buy - search directly + wider radius store locator
  { n: 'BB-search', url: 'https://www.bestbuy.ca/api/2.0/page/search?currentRegion=CA&query=clearance&pageSize=5&lang=en-CA' },
  { n: 'BB-stores-wide', url: 'https://www.bestbuy.ca/api/2.0/stores/bypostalcode?postalCode=V1T3A5&radius=500&lang=en&currentRegion=CA' },
]

export async function GET() {
  const results = []

  // Run sequentially to stay within ScraperAPI free plan (1 concurrent request)
  for (const t of TESTS) {
    try {
      const res = await fetch(proxied(t.url), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
          'Accept': 'application/json, text/html, */*',
          'Accept-Language': 'en-CA,en;q=0.9',
        },
        signal: AbortSignal.timeout(12000),
      })
      let preview = ''
      try { preview = (await res.text()).slice(0, 250) } catch {}
      results.push({ n: t.n, status: res.status, ok: res.ok, preview })
    } catch (e) {
      results.push({ n: t.n, status: 0, error: String(e).slice(0, 80) })
    }
    await delay(600) // stay under concurrency limit
  }

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}
