import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    // Scoreboard logos are currently unoptimized and validated at runtime in
    // teamLogos.ts. Keep the same dark-only boundary if optimization is enabled.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.collegefootballdata.com',
        pathname: '/logos-dark/64/*.png',
      },
    ],
  },
};

export default nextConfig;
