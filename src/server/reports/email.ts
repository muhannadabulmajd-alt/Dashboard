// Email delivery for scheduled reports. Uses Resend's HTTP API when
// RESEND_API_KEY is set; otherwise falls back to a no-op "log" provider so the
// pipeline runs in development without credentials.

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}
export interface SendEmailInput {
  to: string[];
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}
export interface EmailResult {
  provider: 'resend' | 'log';
  delivered: boolean;
  to: string[];
  id?: string;
  error?: string;
}

/** Pure: which provider will be used given the environment. */
export function emailProvider(): 'resend' | 'log' {
  return process.env.RESEND_API_KEY ? 'resend' : 'log';
}

/** Pure: parse a comma-separated recipients env value. */
export function parseRecipients(env: string | undefined): string[] {
  return env
    ? env
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

export async function sendEmail(input: SendEmailInput): Promise<EmailResult> {
  const provider = emailProvider();
  if (!input.to.length) return { provider, delivered: false, to: [], error: 'no recipients' };

  if (provider === 'log') {
    console.log(
      `[email:log] would send "${input.subject}" to ${input.to.join(', ')} ` +
        `with ${input.attachments?.length ?? 0} attachment(s). Set RESEND_API_KEY to deliver.`,
    );
    return { provider: 'log', delivered: false, to: input.to };
  }

  const from = process.env.REPORT_FROM ?? 'Laheeb Atlas <reports@laheeb.coffee>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content.toString('base64'),
        })),
      }),
    });
    if (!res.ok) return { provider: 'resend', delivered: false, to: input.to, error: `HTTP ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { provider: 'resend', delivered: true, to: input.to, id: data?.id };
  } catch (e) {
    return { provider: 'resend', delivered: false, to: input.to, error: e instanceof Error ? e.message : 'send failed' };
  }
}

/** Recipients: explicit REPORT_RECIPIENTS, else active owner/admin/finance users. */
export async function getReportRecipients(): Promise<string[]> {
  const explicit = parseRecipients(process.env.REPORT_RECIPIENTS);
  if (explicit.length) return explicit;
  const { prisma } = await import('@/server/db/client');
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['OWNER', 'ADMIN', 'FINANCE'] } },
    select: { email: true },
  });
  return users.map((u) => u.email);
}
