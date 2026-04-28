import { NextResponse } from 'next/server'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'en-CA,en;q=0.9',
}

const POSTAL = 'V1T3A5'

const TESTS = [
  // Home Depot
  { store: 'homedepot', name: 'HD store v2', url: `https://www.homedepot.ca/api/2.0/storelocator/store?postalCode=${POSTAL}&maxResults=3` },
  { store: 'homedepot', name: 'HD store v1', url: `https://www.homedepot.ca/api/v1/storelocator/store?postalCode=${POSTAL}&maxResults=3` },
  // Walmart
  { store: 'walmart', name: 'WM store v2', url: `https://www.walmart.ca/api/restfulservices/v2/stores?postal=${POSTAL}&count=3` },
  { store: 'walmart', name: 'WM nearby', url: `https://www.walmart.ca/api/2.0/stores/nearBySearch?postalCode=${POSTAL}` },
  { store: 'walmart', name: 'WM store json', url: `https://www.walmart.ca/api/2.0/stores?postalCode=${POSTAL}` },
  // Canadian Tire
  { store: 'canadiantire', name: 'CT store api', url: `https://api.canadiantire.ca/store/api/v1/stores/?postalCode=${POSTAL}&radius=50&maxCount=3` },
  { store: 'canadiantire', name: 'CT store v2', url: `https://api.canadiantire.ca/store/api/v2/stores/?postalCode=${POSTAL}&radius=50&maxCount=3` },
  { store: 'canadiantire', name: 'CT www store', url: `https://www.canadiantire.ca/api/store/locator?postalCode=${POSTAL}&radius=50&count=3` },
  // Best Buy
  { store: 'bestbuy', name: 'BB stores v2', url: `https://www.bestbuy.ca/api/2.0/stores?postalCode=${POSTAL}&maxResults=3&currentRegion=CA` },
  { store: 'bestbuy', name: 'BB stores v1', url: `https://www.bestbuy.ca/api/v1/stores?postalCode=${POSTAL}&maxResults=3` },
  { store: 'bestbuy', name: 'BB storelocator', url: `https://www.bestbuy.ca/api/2.0/storelocator?postalCode=${POSTAL}&lang=en` },
  { store: 'bestbuy', name: 'BB nearby', url: `https://www.bestbuy.ca/api/2.0/stores/nearby?postalCode=${POSTAL}&lang=en` },
]

export async function GET() {
  const results = await Promise.all(TESTS.map(async t => {
    try {
      const res = await fetch(t.url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      })
      let preview = ''
      try {
        const text = await res.text()
        preview = text.slice(0, 120)
      } catch {}
      return { ...t, status: res.status, ok: res.ok, preview }
    } catch (e) {
      return { ...t, status: 0, ok: false, error: String(e).slice(0, 100) }
    }
  }))

  return NextResponse.json(results, { headers: { 'Cache-Control': 'no-store' } })
}
