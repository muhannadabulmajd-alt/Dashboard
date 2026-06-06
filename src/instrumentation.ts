export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { execSync } = await import('child_process');
    try {
      execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    } catch (err) {
      // Log but don't crash startup — Vercel read-only FS on subsequent invocations
      // is fine because migrations are idempotent and may already be applied.
      console.error('[instrumentation] prisma migrate deploy failed:', err);
    }
  }
}
