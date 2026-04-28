import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.homedepot.ca' },
      { protocol: 'https', hostname: '**.walmart.ca' },
      { protocol: 'https', hostname: 'cdn.canadiantire.ca' },
      { protocol: 'https', hostname: '**.bestbuy.ca' },
    ],
  },
}

export default nextConfig
