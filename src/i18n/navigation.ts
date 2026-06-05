import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Locale-aware navigation helpers (keep the [locale] prefix automatically).
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
