import { NextResponse } from 'next/server'

export const runtime = 'edge'

function proxied(url: string) {
  const key = process.env.SCRAPER_API_KEY
  if (!key) return url
  return `https://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(url)}&render=false`
}

const TESTS = [
  // Home Depot store locator variations
  { n: 'HD-1', url: 'https://www.homedepot.ca/api/2.0/storelocator/store?postalCode=V1T3A5&maxResults=3' },
  { n: 'HD-2', url: 'https://www.homedepot.ca/api/2.0/storelocator/stores?postalCode=V1T3A5&maxResults=3' },
  { n: 'HD-3', url: 'https://www.homedepot.ca/api/v1/storelocator?postalCode=V1T3A5&maxResults=3' },
  { n: 'HD-4', url: 'https://www.homedepot.ca/api/2.0/store/search?postalCode=V1T3A5' },
  // Walmart store locator variations
  { n: 'WM-1', url: 'https://www.walmart.ca/api/restfulservices/v2/stores?postal=V1T3A5&count=3' },
  { n: 'WM-2', url: 'https://www.walmart.ca/api/2.0/stores/nearBySearch?postalCode=V1T3A5&seeAllStores=true' },
  { n: 'WM-3', url: 'https://www.walmart.ca/api/2.0/stores?postalCode=V1T3A5' },
  { n: 'WM-4', url: 'https://www.walmart.ca/api/graphql' },
  // Canadian Tire
  { n: 'CT-1', url: 'https://api.canadiantire.ca/store/api/v1/stores/?postalCode=V1T3A5&radius=100&maxCount=3&lang=en' },
  { n: 'CT-2', url: 'https://api.canadiantire.ca/store/api/v2/stores?postalCode=V1T3A5&radius=100&maxCount=3' },
  { n: 'CT-3', url: 'https://www.canadiantire.ca/api/store/v1/stores?postalCode=V1T3A5&radius=100' },
  { n: 'CT-4', url: 'https://api.canadiantire.ca/v1/stores?postalCode=V1T3A5&radius=100' },
  // Best Buy store locator - increase radius, try more patterns
  { n: 'BB-1', url: 'https://www.bestbuy.ca/api/2.0/stores/bypostalcode?postalCode=V1T3A5&radius=300&lang=en&currentRegion=CA' },
  { n: 'BB-2', url: 'https://www.bestbuy.ca/api/2.0/stores?postalCode=V1T3A5&maxResults=5&radius=300&currentRegion=CA' },
  { n: 'BB-3', url: 'https://www.bestbuy.ca/api/2.0/page/search?currentRegion=CA&query=clearance&pageSize=10&lang=en-CA' },
]

export async function GET() {
  const results = await Promise.all(TESTS.map(async t => {
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
      try { preview = (await res.text()).slice(0, 200) } catch {}
      return { n: t.n, status: res.status, ok: res.ok, preview }
    } catch (e) {
      return { n: t.n, status: 0, error: String(e).slice(0, 100) }
    }
  }))

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}
