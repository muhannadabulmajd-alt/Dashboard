import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Messages = Record<string, unknown>;

function leafKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Messages).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

async function loadMessages(locale: 'en' | 'ar'): Promise<Messages> {
  const path = resolve(process.cwd(), 'src', 'i18n', 'messages', `${locale}.json`);
  return JSON.parse(await readFile(path, 'utf8')) as Messages;
}

async function main(): Promise<void> {
  const [english, arabic] = await Promise.all([loadMessages('en'), loadMessages('ar')]);
  const englishKeys = new Set(leafKeys(english));
  const arabicKeys = new Set(leafKeys(arabic));
  const missingArabic = [...englishKeys].filter((key) => !arabicKeys.has(key)).sort();
  const missingEnglish = [...arabicKeys].filter((key) => !englishKeys.has(key)).sort();

  if (missingArabic.length || missingEnglish.length) {
    if (missingArabic.length) console.error(`Missing Arabic keys:\n${missingArabic.join('\n')}`);
    if (missingEnglish.length) console.error(`Missing English keys:\n${missingEnglish.join('\n')}`);
    throw new Error('Translation files are not in parity.');
  }

  console.log(`PASS translation parity: ${englishKeys.size} keys`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
