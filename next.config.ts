import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Prisma client must not be bundled for the server runtime tracing.
  // instrumentation.ts is enabled by default in Next.js 16 (no experimental flag needed).
  serverExternalPackages: ['@prisma/client', 'bcryptjs', '@react-pdf/renderer'],
};

export default withNextIntl(nextConfig);
