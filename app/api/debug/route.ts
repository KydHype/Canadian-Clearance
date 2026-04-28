import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') ?? ''
  const snip = req.nextUrl.searchParams.get('snip') ?? '' // find this string and return surrounding context
  if (!url) return NextResponse.json({ error: 'url param required' }, { status: 400 })

  const key = process.env.SCRAPER_API_KEY
  const proxied = key
    ? `https://api.scraperapi.com?api_key=${key}&url=${encodeURIComponent(url)}&country_code=ca`
    : url

  let origin = ''
  try { origin = new URL(url).origin } catch { origin = '' }

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/html, */*;q=0.9',
    'Accept-Language': 'en-CA,en;q=0.9',
  }
  if (origin) {
    headers['Referer'] = origin + '/'
    headers['Origin'] = origin
  }

  try {
    const res = await fetch(proxied, { headers, signal: AbortSignal.timeout(25000) })
    const text = await res.text()
    const resHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => { resHeaders[k] = v })
    // Search for data patterns to understand what framework/state the page uses
    const dataPatterns = {
      hasNextData: text.includes('__NEXT_DATA__'),
      hasAngularState: text.includes('ng-state') || text.includes('__APP_STATE__') || text.includes('__TRANSFER_STATE__'),
      hasDigitalData: text.includes('digitalData') || text.includes('window.digitalData'),
      hasJsonLd: text.includes('application/ld+json'),
      hasCloudflare: text.includes('cf-browser-verification') || text.includes('Checking your browser') || text.includes('Just a moment') || text.includes('cf_chl'),
      hasCurrentPrice: text.includes('"currentPrice"') || text.includes('"salePrice"'),
      hasWasPrice: text.includes('"wasPrice"') || text.includes('"originalPrice"') || text.includes('"regularPrice"'),
      hasSku: text.includes('"sku"') || text.includes('"productId"') || text.includes('"itemId"'),
      hasItemStacks: text.includes('itemStacks'),
      hasProducts: text.includes('"products"') || text.includes('"items"'),
    }
    // Find Angular transfer state if present
    let ngState = null
    const ngMatch = text.match(/<script[^>]+id=["']ng-state["'][^>]*>([\s\S]*?)<\/script>/i)
    if (ngMatch) {
      try { ngState = JSON.parse(ngMatch[1])  } catch { ngState = ngMatch[1].slice(0, 500) }
    }
    return NextResponse.json({
      scraperApiKeySet: !!key,
      scraperApiKeyPrefix: key ? key.slice(0, 6) + '...' : null,
      targetUrl: url,
      finalUrl: resHeaders['sa-final-url'] ?? null,
      creditCost: resHeaders['sa-credit-cost'] ?? null,
      status: res.status,
      ok: res.ok,
      contentType: resHeaders['content-type'] ?? null,
      bodyLength: text.length,
      dataPatterns,
      ngState,
      bodyPreview: text.slice(0, 3000),
      // If snip= param given, find first occurrence and show surrounding 800 chars
      snipContext: snip ? (() => {
        const idx = text.indexOf(snip)
        if (idx === -1) return `"${snip}" not found in response`
        const start = Math.max(0, idx - 200)
        const end = Math.min(text.length, idx + 600)
        return text.slice(start, end)
      })() : undefined,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), targetUrl: url })
  }
}
