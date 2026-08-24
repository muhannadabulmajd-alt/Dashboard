import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registration: vi.fn(),
  authentication: vi.fn(),
  verifyRegistration: vi.fn(),
  verifyAuthentication: vi.fn(),
  activeSession: vi.fn(),
  customerFind: vi.fn(),
  challengeCreate: vi.fn(),
  challengeFind: vi.fn(),
}));

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: mocks.registration,
  generateAuthenticationOptions: mocks.authentication,
  verifyRegistrationResponse: mocks.verifyRegistration,
  verifyAuthenticationResponse: mocks.verifyAuthentication,
}));

vi.mock('@/server/storefront/customer-access', () => ({
  requireActiveStorefrontSession: mocks.activeSession,
}));

vi.mock('@/server/db/client', () => ({
  prisma: {
    customer: { findUnique: mocks.customerFind },
    storefrontPasskeyChallenge: { create: mocks.challengeCreate, findFirst: mocks.challengeFind },
  },
}));

const config = {
  enabled: true as const,
  runtime: 'preview' as const,
  origin: 'https://store-git-staging.example.vercel.app',
};

describe('storefront passkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeSession.mockResolvedValue({ session: { customerId: 'customer-1' } });
    mocks.customerFind.mockResolvedValue({
      id: 'customer-1', externalId: 'LHB-CUS-1', phone: '+9647700000000', nameEn: 'Customer', nameAr: null,
      storefrontPasskeys: [],
    });
    mocks.registration.mockResolvedValue({ challenge: 'registration-challenge' });
    mocks.authentication.mockResolvedValue({ challenge: 'authentication-challenge' });
    mocks.challengeCreate.mockResolvedValue({ id: 'challenge-1' });
  });

  it('binds registration options to the active customer and exact Store RP ID', async () => {
    const { registrationOptions } = await import('@/server/storefront/passkeys');
    const options = await registrationOptions('Bearer opaque-session', config);
    expect(options).toEqual({ challenge: 'registration-challenge' });
    expect(mocks.registration).toHaveBeenCalledWith(expect.objectContaining({
      rpID: 'store-git-staging.example.vercel.app',
      userName: '+9647700000000',
      authenticatorSelection: expect.objectContaining({ residentKey: 'required', userVerification: 'required' }),
    }));
    expect(mocks.challengeCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      challenge: 'registration-challenge', purpose: 'REGISTRATION', customerId: 'customer-1',
    }) });
  });

  it('creates a discoverable authentication challenge without exposing customer records', async () => {
    const { authenticationOptions } = await import('@/server/storefront/passkeys');
    await expect(authenticationOptions(config)).resolves.toEqual({ challenge: 'authentication-challenge' });
    expect(mocks.authentication).toHaveBeenCalledWith(expect.objectContaining({
      rpID: 'store-git-staging.example.vercel.app', userVerification: 'required',
    }));
    expect(mocks.customerFind).not.toHaveBeenCalled();
  });

  it('rejects an expired or already-used authentication challenge before credential lookup', async () => {
    mocks.challengeFind.mockResolvedValue(null);
    const { verifyPasskeyAuthentication } = await import('@/server/storefront/passkeys');
    await expect(verifyPasskeyAuthentication({
      challenge: 'expired', response: { id: 'credential' } as never, config,
    })).rejects.toMatchObject({ code: 'challenge_invalid', status: 409 });
  });
});
