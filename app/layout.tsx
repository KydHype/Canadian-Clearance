import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Canadian Clearance',
  description: 'Find hidden clearance deals at Home Depot, Walmart, Canadian Tire, and Best Buy Canada',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-zinc-950 antialiased">{children}</body>
    </html>
  )
}
