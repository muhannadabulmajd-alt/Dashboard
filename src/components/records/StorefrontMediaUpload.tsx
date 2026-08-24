'use client';

import { useRef, useState } from 'react';
import { ImageUp, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function StorefrontMediaUpload({
  target,
  targetId,
  locale,
}: {
  target: 'product' | 'productGroup';
  targetId: string;
  locale: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const ar = locale === 'ar';

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(undefined);
    const body = new FormData();
    body.set('file', file);
    body.set('target', target);
    body.set('targetId', targetId);
    try {
      const response = await fetch('/api/storefront/media', { method: 'POST', body });
      if (!response.ok) throw new Error('upload_failed');
      setMessage(ar ? 'تم تحديث صورة المتجر.' : 'Store image updated.');
      router.refresh();
    } catch {
      setMessage(ar ? 'تعذر تحديث الصورة. استخدم JPG أو PNG أو WebP أصغر من 5MB.' : 'Could not update the image. Use a JPG, PNG, WebP, or AVIF under 5MB.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="sr-only"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ImageUp className="size-4" />}
        {busy ? (ar ? 'جارٍ الرفع...' : 'Uploading...') : (ar ? 'تحديث صورة المتجر' : 'Update store image')}
      </button>
      {message ? <p className="max-w-64 text-xs text-muted-foreground" role="status">{message}</p> : null}
    </div>
  );
}
