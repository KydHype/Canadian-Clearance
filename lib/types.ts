export type StoreId = 'homedepot' | 'walmart' | 'canadiantire' | 'bestbuy'

export interface StoreLocation {
  storeNo: string
  name: string
  address: string
  city: string
  province: string
  postalCode: string
  distance?: number
}

export interface ClearanceItem {
  id: string
  storeId: StoreId
  storeLocation: StoreLocation
  name: string
  brand?: string
  sku: string
  upc?: string
  originalPrice: number
  clearancePrice: number
  discountPercent: number
  category?: string
  imageUrl?: string
  productUrl?: string
  inStock: boolean
  isPenny: boolean
}

export interface StoreResult {
  storeId: StoreId
  storeName: string
  items: ClearanceItem[]
  error?: string
  loading?: boolean
}

export interface SavedItem extends ClearanceItem {
  savedAt: string
  note?: string
}

export interface SearchState {
  postalCode: string
  selectedStores: StoreId[]
  minDiscount: number
  results: StoreResult[]
  loading: boolean
  hasSearched: boolean
}

export const STORE_META: Record<StoreId, { label: string; color: string; bgColor: string; available: boolean }> = {
  homedepot: { label: 'Home Depot', color: '#FF6600', bgColor: '#fff3eb', available: false },
  walmart: { label: 'Walmart', color: '#0071CE', bgColor: '#e8f4ff', available: true },
  canadiantire: { label: 'Canadian Tire', color: '#CC0000', bgColor: '#fff0f0', available: false },
  bestbuy: { label: 'Best Buy', color: '#003B64', bgColor: '#e8f0f7', available: false },
}
