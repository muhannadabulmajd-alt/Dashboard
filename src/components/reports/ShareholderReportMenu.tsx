'use client';

import { useState } from 'react';
import { ChevronDown, FileSpreadsheet, FileText } from 'lucide-react';

export function ShareholderReportMenu({ locale, label }: { locale: 'ar' | 'en'; label: string }) {
  const [open, setOpen] = useState(false);
  const itemClass = 'flex w-full items-center gap-2 rounded px-3 py-2 text-start text-xs hover:bg-muted';
  const download = (href: string) => {
    setOpen(false);
    window.location.assign(href);
  };
  return <div className="relative">
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
    >
      <FileText className="size-3.5" />
      {label}
      <ChevronDown className="size-3.5" />
    </button>
    {open ? <div className="absolute end-0 z-30 mt-2 w-64 rounded-lg border bg-card p-1 shadow-lg">
      <button type="button" className={itemClass} onClick={() => download('/api/reports/shareholder/pdf?locale=ar')}>
        <FileText className="size-4" /> التقرير العربي (PDF)
      </button>
      <button type="button" className={itemClass} onClick={() => download('/api/reports/shareholder/pdf?locale=en')}>
        <FileText className="size-4" /> English report (PDF)
      </button>
      <button type="button" className={itemClass} onClick={() => download('/api/reports/shareholder/xlsx')}>
        <FileSpreadsheet className="size-4" /> {locale === 'ar' ? 'ملف التدقيق الثنائي (Excel)' : 'Bilingual audit workbook (Excel)'}
      </button>
    </div> : null}
  </div>;
}
