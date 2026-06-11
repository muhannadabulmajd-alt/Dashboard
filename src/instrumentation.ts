export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.PRISMA_MIGRATE_ON_STARTUP !== 'true') return;

    const { execSync } = await import('child_process');
    try {
      execSync('pnpm prisma migrate deploy', { stdio: 'inherit' });
    } catch (err) {
      // Startup migrations are opt-in because Vercel runtime environments should
      // not run package-manager commands on every serverless cold start.
      console.error('[instrumentation] prisma migrate deploy failed:', err);
    }
  }
}
