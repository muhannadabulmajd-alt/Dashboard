import 'server-only';

import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { prisma } from '@/server/db/client';
import { sha256Hex } from './auth';
import type { StorefrontConfig } from './config';
import { requireActiveStorefrontSession } from './customer-access';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RP_NAME = 'Laheeb Coffee';

type EnabledStorefrontConfig = StorefrontConfig & {
  enabled: true;
  origin: string;
};

export class StorefrontPasskeyError extends Error {
  constructor(
    readonly code:
      | 'invalid_request'
      | 'challenge_invalid'
      | 'credential_invalid'
      | 'credential_exists',
    readonly status: number = 400,
  ) {
    super(code);
    this.name = 'StorefrontPasskeyError';
  }
}

function rpId(config: EnabledStorefrontConfig): string {
  return new URL(config.origin).hostname;
}

async function storeChallenge(input: {
  challenge: string;
  purpose: 'REGISTRATION' | 'AUTHENTICATION';
  customerId?: string;
}) {
  await prisma.storefrontPasskeyChallenge.create({
    data: {
      challenge: input.challenge,
      purpose: input.purpose,
      customerId: input.customerId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
}

async function loadChallenge(input: {
  challenge: string;
  purpose: 'REGISTRATION' | 'AUTHENTICATION';
  customerId?: string;
}) {
  const record = await prisma.storefrontPasskeyChallenge.findFirst({
    where: {
      challenge: input.challenge,
      purpose: input.purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
      ...(input.customerId ? { customerId: input.customerId } : {}),
    },
    select: { id: true, customerId: true },
  });
  if (!record) throw new StorefrontPasskeyError('challenge_invalid', 409);
  return record;
}

export async function registrationOptions(
  authorization: string | null,
  config: EnabledStorefrontConfig,
) {
  const { session } = await requireActiveStorefrontSession(authorization);
  const customer = await prisma.customer.findUnique({
    where: { id: session.customerId },
    select: {
      id: true,
      externalId: true,
      phone: true,
      nameEn: true,
      nameAr: true,
      storefrontPasskeys: { select: { credentialId: true, transports: true } },
    },
  });
  if (!customer) throw new StorefrontPasskeyError('credential_invalid', 404);
  const displayName = customer.nameAr || customer.nameEn || customer.phone || customer.externalId || 'Laheeb customer';
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(config),
    userID: new TextEncoder().encode(customer.id),
    userName: customer.phone || customer.externalId || customer.id,
    userDisplayName: displayName,
    timeout: 60_000,
    attestationType: 'none',
    excludeCredentials: customer.storefrontPasskeys.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
  });
  await storeChallenge({ challenge: options.challenge, purpose: 'REGISTRATION', customerId: customer.id });
  return options;
}

export async function verifyPasskeyRegistration(input: {
  authorization: string | null;
  challenge: string;
  response: RegistrationResponseJSON;
  config: EnabledStorefrontConfig;
}) {
  const { session } = await requireActiveStorefrontSession(input.authorization);
  const challenge = await loadChallenge({
    challenge: input.challenge,
    purpose: 'REGISTRATION',
    customerId: session.customerId,
  });
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: input.challenge,
    expectedOrigin: input.config.origin,
    expectedRPID: rpId(input.config),
    requireUserVerification: true,
  }).catch(() => null);
  if (!verification?.verified || !verification.registrationInfo) {
    throw new StorefrontPasskeyError('credential_invalid', 400);
  }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  try {
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.storefrontPasskeyChallenge.updateMany({
        where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) throw new StorefrontPasskeyError('challenge_invalid', 409);
      await tx.storefrontPasskeyCredential.create({
        data: {
          customerId: session.customerId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: credential.transports ?? input.response.response.transports ?? [],
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
        },
      });
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      throw new StorefrontPasskeyError('credential_exists', 409);
    }
    throw error;
  }
  return { registered: true };
}

export async function authenticationOptions(config: EnabledStorefrontConfig) {
  const options = await generateAuthenticationOptions({
    rpID: rpId(config),
    timeout: 60_000,
    userVerification: 'required',
  });
  await storeChallenge({ challenge: options.challenge, purpose: 'AUTHENTICATION' });
  return options;
}

export async function verifyPasskeyAuthentication(input: {
  challenge: string;
  response: AuthenticationResponseJSON;
  config: EnabledStorefrontConfig;
}) {
  const challenge = await loadChallenge({ challenge: input.challenge, purpose: 'AUTHENTICATION' });
  const saved = await prisma.storefrontPasskeyCredential.findUnique({
    where: { credentialId: input.response.id },
    select: { id: true, customerId: true, credentialId: true, publicKey: true, counter: true, transports: true },
  });
  if (!saved || saved.counter > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new StorefrontPasskeyError('credential_invalid', 401);
  }
  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: input.challenge,
    expectedOrigin: input.config.origin,
    expectedRPID: rpId(input.config),
    credential: {
      id: saved.credentialId,
      publicKey: new Uint8Array(saved.publicKey),
      counter: Number(saved.counter),
      transports: saved.transports as AuthenticatorTransportFuture[],
    },
    requireUserVerification: true,
  }).catch(() => null);
  if (!verification?.verified) throw new StorefrontPasskeyError('credential_invalid', 401);

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.storefrontPasskeyChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw new StorefrontPasskeyError('challenge_invalid', 409);
    await tx.storefrontPasskeyCredential.update({
      where: { id: saved.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });
    await tx.storefrontCustomerSession.create({
      data: { customerId: saved.customerId, tokenHash: sha256Hex(token), expiresAt },
    });
  });
  return { token, expiresAt: expiresAt.toISOString() };
}
