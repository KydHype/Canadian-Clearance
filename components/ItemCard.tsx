'use client'

import { useState } from 'react'
import type { ClearanceItem } from '@/lib/types'
import { STORE_META } from '@/lib/types'
import { getFreshnessLabel } from '@/lib/freshness'

interface Props {
  item: ClearanceItem
  freshnessScore: number
  saved: boolean
  onSave: (item: ClearanceItem) => void
  onUnsave: (id: string) => void
}

export default function ItemCard({ item, freshnessScore, saved, onSave, onUnsave }: Props) {
  const [copied, setCopied] = useState(false)
  const meta = STORE_META[item.storeId]
  const freshness = getFreshnessLabel(freshnessScore)

  function copySku() {
    navigator.clipboard.writeText(item.sku).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      className="bg-zinc-900 rounded-xl overflow-hidden flex flex-col border"
      style={{ borderColor: freshness.ring + '55' }}
    >
      {item.imageUrl && (
        <div className="bg-zinc-800 h-32 flex items-center justify-center overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt={item.name}
            className="h-full w-full object-contain p-2"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
      )}

      <div className="p-3 flex flex-col gap-2 flex-1">
        {/* Top row: store + penny/discount badge */}
        <div className="flex items-center justify-between gap-1">
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
            style={{ backgroundColor: meta.bgColor, color: meta.color }}
          >
            {meta.label}
          </span>
          {item.isPenny ? (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-yellow-400 text-yellow-900">
              PENNY
            </span>
          ) : item.discountPercent >= 50 ? (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-700 text-white">
              -{item.discountPercent}%
            </span>
          ) : null}
        </div>

        {/* Name */}
        <p className="text-sm text-white font-medium leading-snug line-clamp-2 flex-1">
          {item.name}
        </p>

        {item.brand && (
          <p className="text-xs text-zinc-500">{item.brand}</p>
        )}

        {/* Price row */}
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-green-400">
            ${item.clearancePrice.toFixed(2)}
          </span>
          {item.originalPrice > item.clearancePrice && (
            <span className="text-sm text-zinc-500 line-through">
              ${item.originalPrice.toFixed(2)}
            </span>
          )}
          {item.discountPercent > 0 && !item.isPenny && item.discountPercent < 50 && (
            <span className="text-xs text-zinc-400 ml-auto">-{item.discountPercent}%</span>
          )}
        </div>

        {/* Freshness score bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold" style={{ color: freshness.color }}>
              {freshness.label}
            </span>
            <span className="text-xs font-mono" style={{ color: freshness.color }}>
              {freshnessScore}
            </span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${freshnessScore}%`,
                backgroundColor: freshness.color,
              }}
            />
          </div>
        </div>

        {/* Store location */}
        <p className="text-xs text-zinc-500 truncate">
          {item.storeLocation.city}
          {item.storeLocation.distance != null && ` · ${item.storeLocation.distance.toFixed(1)} km`}
        </p>

        {/* Actions */}
        <div className="flex gap-2 mt-1">
          <button
            onClick={copySku}
            className="flex-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg py-2 px-2 transition-colors font-mono truncate"
          >
            {copied ? '✓ Copied!' : item.sku}
          </button>
          <button
            onClick={() => saved ? onUnsave(item.id) : onSave(item)}
            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
              saved
                ? 'bg-yellow-500 text-black hover:bg-yellow-400'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
            }`}
          >
            {saved ? '★' : '☆'}
          </button>
          {item.productUrl && (
            <a
              href={item.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 rounded-lg text-sm bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors"
            >
              ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
