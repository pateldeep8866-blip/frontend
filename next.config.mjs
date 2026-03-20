/** @type {import('next').NextConfig} */
const isMobileBuild = process.env.CAPACITOR_BUILD === '1';

const nextConfig = {
  ...(isMobileBuild ? { output: 'export' } : {}),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
