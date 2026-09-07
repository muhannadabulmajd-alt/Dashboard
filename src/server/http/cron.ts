import 'server-only';

export function isCronAuthorized(request: Pick<Request, 'headers'>): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}
