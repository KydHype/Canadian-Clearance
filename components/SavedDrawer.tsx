'use client'

import { useState } from 'react'
import type { SavedItem } from '@/lib/types'
import { STORE_META } from '@/lib/types'

interface Props {
  items: SavedItem[]
  onUnsave: (id: string) => void
  onUpdateNote: (id: string, note: string) => void
}

export default function SavedDrawer({ items, onUnsave, onUpdateNote }: Props) {
  const [open, setOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<string | null>(null)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 bg-yellow-400 text-black font-bold rounded-full w-14 h-14 text-xl shadow-lg hover:bg-yellow-300 transition-colors flex items-center justify-center"
        aria-label="Saved items"
      >
        ★
        {items.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
            {items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60" onClick={() => setOpen(false)} />
          <div className="w-full max-w-sm bg-zinc-950 border-l border-zinc-800 flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
              <h2 className="text-white font-bold text-lg">Saved ({items.length})</h2>
              <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-white text-xl">✕</button>
            </div>

            {items.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
                No saved items yet.<br />Tap ☆ on any item to save it.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                {items.map(item => {
                  const meta = STORE_META[item.storeId]
                  return (
                    <div key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium leading-snug line-clamp-2">{item.name}</p>
                          <p className="text-xs mt-0.5" style={{ color: meta.color }}>{meta.label}</p>
                        </div>
                        <button
                          onClick={() => onUnsave(item.id)}
                          className="text-zinc-500 hover:text-red-400 text-lg flex-shrink-0"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-green-400 font-bold">${item.clearancePrice.toFixed(2)}</span>
                        {item.isPenny && <span className="text-xs bg-yellow-400 text-yellow-900 px-1.5 rounded font-bold">PENNY</span>}
                        <span className="text-zinc-600 text-xs ml-auto">SKU: {item.sku}</span>
                      </div>

                      {editingNote === item.id ? (
                        <textarea
                          className="w-full bg-zinc-800 text-white text-xs rounded p-2 resize-none border border-zinc-700 focus:outline-none focus:border-zinc-500"
                          rows={2}
                          defaultValue={item.note ?? ''}
                          autoFocus
                          onBlur={(e) => {
                            onUpdateNote(item.id, e.target.value)
                            setEditingNote(null)
                          }}
                          placeholder="Add a note..."
                        />
                      ) : (
                        <button
                          onClick={() => setEditingNote(item.id)}
                          className="text-left text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          {item.note ? `📝 ${item.note}` : '+ Add note'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
