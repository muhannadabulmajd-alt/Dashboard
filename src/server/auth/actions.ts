'use server';

import { AuthError } from 'next-auth';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { signIn, signOut } from './config';
import { getCurrentUser } from './session';
import { can } from '@/lib/rbac';
import { ROLES } from '@/lib/enums';
import { prisma } from '@/server/db/client';

export type LoginState = { error?: string } | undefined;

/** Credentials sign-in used by the login form (useActionState). */
export async function authenticate(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const redirectTo = String(formData.get('redirectTo') || '/');
  try {
    await signIn('credentials', { email, password, redirectTo });
    return undefined;
  } catch (error) {
    // signIn throws a redirect on success — let it propagate.
    if (error instanceof AuthError) return { error: 'invalid' };
    throw error;
  }
}

export async function signOutAction(locale: string): Promise<void> {
  await signOut({ redirectTo: `/${locale}/login` });
}

export type CreateUserState = { error?: string; ok?: boolean } | undefined;

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
  branchId: z.string().optional(),
});

/** Admin-only user creation (no public sign-up). */
export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const current = await getCurrentUser();
  if (!current || !can(current.role, 'manage:users')) return { error: 'forbidden' };

  const parsed = createUserSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
    branchId: formData.get('branchId') || undefined,
  });
  if (!parsed.success) return { error: 'invalid' };

  const { name, email, password, role, branchId } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const exists = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (exists) return { error: 'exists' };

  const hashedPassword = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      name,
      email: normalizedEmail,
      hashedPassword,
      role,
      branchId: branchId || null,
      createdById: current.id,
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: current.id,
      action: 'CREATE_USER',
      entity: 'User',
      metadata: { email: normalizedEmail, role },
    },
  });

  revalidatePath('/[locale]/(dashboard)/admin/users', 'page');
  return { ok: true };
}
