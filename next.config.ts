import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.collegefootballdata.com',
        pathname: '/logos-dark/32/*.png',
      },
      {
        protocol: 'https',
        hostname: 'cdn.collegefootballdata.com',
        pathname: '/logos-dark/48/*.png',
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
