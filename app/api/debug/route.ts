import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') ?? ''
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
    return NextResponse.json({
      scraperApiKeySet: !!key,
      scraperApiKeyPrefix: key ? key.slice(0, 6) + '...' : null,
      targetUrl: url,
      status: res.status,
      ok: res.ok,
      contentType: resHeaders['content-type'] ?? null,
      bodyLength: text.length,
      hasNextData: text.includes('__NEXT_DATA__'),
      hasCloudflare: text.includes('cf-browser-verification') || text.includes('Checking your browser') || text.includes('Just a moment'),
      bodyPreview: text.slice(0, 4000),
      responseHeaders: resHeaders,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), targetUrl: url })
  }
}
