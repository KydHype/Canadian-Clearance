import { NextRequest, NextResponse } from 'next/server'
import type { StoreId, StoreResult } from '@/lib/types'
import { findHDStores, getHDClearance } from '@/lib/scrapers/homedepot'
import { findWalmartStores, getWalmartClearance } from '@/lib/scrapers/walmart'
import { findCTStores, getCTClearance } from '@/lib/scrapers/canadiantire'
import { findBBStores, getBBClearance } from '@/lib/scrapers/bestbuy'

const scrapers: Record<StoreId, {
  label: string
  findStores: (postal: string) => Promise<import('@/lib/types').StoreLocation[]>
  getClearance: (store: import('@/lib/types').StoreLocation) => Promise<import('@/lib/types').ClearanceItem[]>
}> = {
  homedepot: { label: 'Home Depot', findStores: findHDStores, getClearance: getHDClearance },
  walmart: { label: 'Walmart', findStores: findWalmartStores, getClearance: getWalmartClearance },
  canadiantire: { label: 'Canadian Tire', findStores: findCTStores, getClearance: getCTClearance },
  bestbuy: { label: 'Best Buy', findStores: findBBStores, getClearance: getBBClearance },
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const postalCode = searchParams.get('postal')?.trim()
  const storesParam = searchParams.get('stores') ?? 'homedepot,walmart,canadiantire,bestbuy'
  const minDiscount = parseInt(searchParams.get('minDiscount') ?? '0', 10)

  if (!postalCode) {
    return NextResponse.json({ error: 'postal required' }, { status: 400 })
  }

  const storeIds = storesParam.split(',').filter((s): s is StoreId => s in scrapers)

  const results: StoreResult[] = await Promise.all(
    storeIds.map(async (storeId): Promise<StoreResult> => {
      const scraper = scrapers[storeId]
      try {
        const stores = await scraper.findStores(postalCode)
        if (!stores.length) {
          return { storeId, storeName: scraper.label, items: [], error: 'No stores found near that postal code' }
        }
        // Use the closest store
        const closest = stores[0]
        const allItems = await scraper.getClearance(closest)
        const items = allItems
          .filter(item => item.discountPercent >= minDiscount)
          .sort((a, b) => b.discountPercent - a.discountPercent)
        return { storeId, storeName: scraper.label, items }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return { storeId, storeName: scraper.label, items: [], error: message }
      }
    })
  )

  return NextResponse.json({ results })
}
