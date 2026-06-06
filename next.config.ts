import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  serverExternalPackages: ['@prisma/client', 'bcryptjs', '@react-pdf/renderer'],
  experimental: {
    instrumentationHook: true,
  },
};

export default withNextIntl(nextConfig);
