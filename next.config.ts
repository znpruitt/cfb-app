import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.collegefootballdata.com',
        pathname: '/logos/64/*.png',
      },
      {
        protocol: 'https',
        hostname: 'cdn.collegefootballdata.com',
        pathname: '/logos-dark/64/*.png',
      },
    ],
  },
};

export default nextConfig;
