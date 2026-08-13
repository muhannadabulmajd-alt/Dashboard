import type { ReactNode } from 'react';

function inline(value: string): ReactNode[] {
  const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-linen px-1 py-0.5 font-mono text-[0.92em] text-roast">{part.slice(1, -1)}</code>;
    return part;
  });
}

export function AssistantText({ value }: { value: string }) {
  return (
    <div dir="auto" className="space-y-1 whitespace-pre-wrap break-words text-sm leading-7">
      {value.split('\n').map((line, index) => <p key={`${index}-${line.slice(0, 16)}`}>{inline(line)}</p>)}
    </div>
  );
}
