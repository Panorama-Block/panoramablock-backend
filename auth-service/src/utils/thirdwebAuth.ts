import { randomUUID } from 'node:crypto';
import {
  createPublicClient,
  getAddress,
  hashMessage,
  http,
  recoverMessageAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const LOGIN_PAYLOAD_DURATION_SECONDS = 60 * 10;
const TOKEN_DURATION_SECONDS = 60 * 60 * 24;

const EIP1271_MAGIC_VALUE = '0x1626ba7e';

const EIP1271_ABI = [
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [
      { name: '_hash', type: 'bytes32' },
      { name: '_signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes4' }],
  },
] as const;

export interface LoginPayloadData {
  type: 'evm';
  domain: string;
  address: string;
  statement: string;
  uri?: string;
  version: string;
  chain_id?: string;
  nonce: string;
  issued_at: string;
  expiration_time: string;
  invalid_before: string;
  resources?: string[];
}

export interface SignedLoginPayload {
  payload: LoginPayloadData;
  signature: `0x${string}` | string;
}

interface AuthenticationPayloadData {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  ctx?: unknown;
}

interface AuthenticationPayload {
  payload: AuthenticationPayloadData;
  signature: string;
}

export interface AuthenticatedUser {
  address: string;
  session?: unknown;
}

function getAuthDomain(): string {
  return process.env.AUTH_DOMAIN || 'panoramablock.com';
}

function getPrivateKey(): `0x${string}` {
  const value = process.env.AUTH_PRIVATE_KEY;

  if (!value || value.trim() === '') {
    throw new Error('AUTH_PRIVATE_KEY is not set');
  }

  const normalized = value.startsWith('0x') ? value : `0x${value}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('AUTH_PRIVATE_KEY is not a valid 32-byte EVM private key');
  }

  return normalized as `0x${string}`;
}

function getSigningAccount() {
  return privateKeyToAccount(getPrivateKey());
}

export const isAuthConfigured = (): boolean => {
  const privateKey = process.env.AUTH_PRIVATE_KEY;
  return Boolean(privateKey && privateKey.trim() !== '');
};

function base64Encode(data: string): string {
  return Buffer.from(data).toString('base64').replace(/=/g, '');
}

function base64Decode(data: string): string {
  return Buffer.from(data, 'base64').toString();
}

function createLoginMessage(payload: LoginPayloadData): string {
  const header =
    `${payload.domain} wants you to sign in with your Ethereum account:`;

  let prefix = [header, payload.address].join('\n');
  prefix = [prefix, payload.statement].join('\n\n');

  if (payload.statement) {
    prefix += '\n';
  }

  const suffix: string[] = [];

  if (payload.uri) {
    suffix.push(`URI: ${payload.uri}`);
  }

  suffix.push(`Version: ${payload.version}`);

  if (payload.chain_id) {
    suffix.push(`Chain ID: ${payload.chain_id}`);
  }

  suffix.push(`Nonce: ${payload.nonce}`);
  suffix.push(`Issued At: ${payload.issued_at}`);
  suffix.push(`Expiration Time: ${payload.expiration_time}`);

  if (payload.invalid_before) {
    suffix.push(`Not Before: ${payload.invalid_before}`);
  }

  if (payload.resources) {
    suffix.push(
      ['Resources:', ...payload.resources.map((resource) => `- ${resource}`)]
        .join('\n')
    );
  }

  return [prefix, suffix.join('\n')].join('\n');
}

function chainIdToRpcUrl(chainId: number): string | undefined {
  switch (chainId) {
    case 1:
      return process.env.ETHEREUM_RPC_URL || process.env.RPC_URL;

    case 137:
      return process.env.POLYGON_RPC_URL;

    case 56:
      return process.env.BSC_RPC_URL;

    case 8453:
      return process.env.BASE_RPC_URL;

    case 10:
      return process.env.OPTIMISM_RPC_URL;

    case 42161:
      return process.env.ARBITRUM_RPC_URL;

    case 43114:
      return process.env.AVALANCHE_RPC_URL || process.env.AVAX_RPC_URL;

    default:
      return undefined;
  }
}

async function verifyContractWalletSignature(
  message: string,
  signature: string,
  address: string,
  chainId: number
): Promise<boolean> {
  const rpcUrl = chainIdToRpcUrl(chainId);

  if (!rpcUrl) {
    console.warn(
      `[auth] No configured RPC for chain ${chainId}; cannot perform EIP-1271 verification`
    );
    return false;
  }

  try {
    const client = createPublicClient({
      transport: http(rpcUrl),
    });

    const result = await client.readContract({
      address: getAddress(address),
      abi: EIP1271_ABI,
      functionName: 'isValidSignature',
      args: [
        hashMessage(message),
        signature as `0x${string}`,
      ],
    });

    return result.toLowerCase() === EIP1271_MAGIC_VALUE;
  } catch (error) {
    console.warn(
      `[auth] EIP-1271 verification failed for chain ${chainId}:`,
      error instanceof Error ? error.message : String(error)
    );

    return false;
  }
}

async function verifyLoginPayload(
  loginPayload: SignedLoginPayload,
  expectedDomain = getAuthDomain()
): Promise<string> {
  if (!loginPayload || !loginPayload.payload || !loginPayload.signature) {
    throw new Error('Invalid login payload');
  }

  const payload = loginPayload.payload;

  if (payload.type !== 'evm') {
    throw new Error('Unsupported account type');
  }

  if (payload.domain !== expectedDomain) {
    throw new Error(
      `Expected domain '${expectedDomain}' does not match domain on payload '${payload.domain}'`
    );
  }

  const currentTime = new Date();

  if (currentTime < new Date(payload.invalid_before)) {
    throw new Error('Login request is not yet valid');
  }

  if (currentTime > new Date(payload.expiration_time)) {
    throw new Error('Login request has expired');
  }

  const claimedAddress = getAddress(payload.address);
  const message = createLoginMessage(payload);

  try {
    const recoveredAddress = await recoverMessageAddress({
      message,
      signature: loginPayload.signature as `0x${string}`,
    });

    if (
      recoveredAddress.toLowerCase() === claimedAddress.toLowerCase()
    ) {
      return claimedAddress;
    }
  } catch {
    // EOA verification failed. Contract-wallet verification follows.
  }

  if (!payload.chain_id) {
    throw new Error(
      `Signer address does not match payload address '${claimedAddress.toLowerCase()}'`
    );
  }

  const chainId = Number(payload.chain_id);

  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error('Invalid chain ID in login payload');
  }

  const contractVerified = await verifyContractWalletSignature(
    message,
    loginPayload.signature,
    claimedAddress,
    chainId
  );

  if (!contractVerified) {
    throw new Error(
      `Signer address does not match payload address '${claimedAddress.toLowerCase()}'`
    );
  }

  return claimedAddress;
}

async function buildToken(
  payload: AuthenticationPayloadData
): Promise<string> {
  const account = getSigningAccount();

  const signature = await account.signMessage({
    message: JSON.stringify(payload),
  });

  const header = {
    alg: 'ES256',
    typ: 'JWT',
  };

  return [
    base64Encode(JSON.stringify(header)),
    base64Encode(JSON.stringify(payload)),
    base64Encode(signature),
  ].join('.');
}

function parseToken(token: string): AuthenticationPayload {
  const parts = token.split('.');

  if (parts.length !== 3) {
    throw new Error('Invalid authentication token');
  }

  try {
    const payload = JSON.parse(
      base64Decode(parts[1])
    ) as AuthenticationPayloadData;

    const signature = base64Decode(parts[2]);

    return {
      payload,
      signature,
    };
  } catch {
    throw new Error('Invalid authentication token');
  }
}

export const getAuthInstance = () => {
  if (!isAuthConfigured()) {
    throw new Error('AUTH_PRIVATE_KEY is not set');
  }

  const account = getSigningAccount();

  return {
    address: account.address,
    domain: getAuthDomain(),
  };
};

export const generateLoginPayload = async (
  address: string
): Promise<LoginPayloadData> => {
  getAuthInstance();

  const now = Date.now();

  return {
    type: 'evm',
    domain: getAuthDomain(),
    address: getAddress(address),
    statement: 'Login to Panorama Block platform',
    version: '1',
    nonce: randomUUID(),
    issued_at: new Date(now).toISOString(),
    expiration_time: new Date(
      now + LOGIN_PAYLOAD_DURATION_SECONDS * 1000
    ).toISOString(),
    invalid_before: new Date(
      now - LOGIN_PAYLOAD_DURATION_SECONDS * 1000
    ).toISOString(),
  };
};

export const verifySignature = async (
  payload: LoginPayloadData,
  signature: string
): Promise<string> => {
  return verifyLoginPayload({
    payload,
    signature,
  });
};

export const generateToken = async (
  loginPayload: SignedLoginPayload
): Promise<string> => {
  const userAddress = await verifyLoginPayload(loginPayload);
  const account = getSigningAccount();

  const now = Math.floor(Date.now() / 1000);

  return buildToken({
    iss: account.address,
    sub: userAddress,
    aud: getAuthDomain(),
    nbf: now,
    exp: now + TOKEN_DURATION_SECONDS,
    iat: now,
    jti: randomUUID(),
  });
};

export const validateToken = async (
  token: string
): Promise<AuthenticatedUser> => {
  const {
    payload,
    signature,
  } = parseToken(token);

  const domain = getAuthDomain();

  if (
    payload.aud !== domain &&
    !(
      payload.aud === 'panoramablock' &&
      domain !== 'panoramablock'
    )
  ) {
    throw new Error(
      `Expected token to be for the domain '${domain}', but found token with domain '${payload.aud}'`
    );
  }

  const now = Math.floor(Date.now() / 1000);

  if (now < payload.nbf) {
    throw new Error(
      `This token is invalid before epoch time '${payload.nbf}', current epoch time is '${now}'`
    );
  }

  if (now > payload.exp) {
    throw new Error(
      `This token expired at epoch time '${payload.exp}', current epoch time is '${now}'`
    );
  }

  const account = getSigningAccount();

  if (
    account.address.toLowerCase() !== payload.iss.toLowerCase()
  ) {
    throw new Error(
      `The expected issuer address '${account.address}' did not match the token issuer address '${payload.iss}'`
    );
  }

  let recoveredAddress: string;

  try {
    recoveredAddress = await recoverMessageAddress({
      message: JSON.stringify(payload),
      signature: signature as `0x${string}`,
    });
  } catch {
    throw new Error(
      `The expected signer address '${account.address}' did not sign the token`
    );
  }

  if (
    recoveredAddress.toLowerCase() !== account.address.toLowerCase()
  ) {
    throw new Error(
      `The expected signer address '${account.address}' did not sign the token`
    );
  }

  return {
    address: payload.sub,
    session: payload.ctx,
  };
};

// Exported only for focused regression tests.
export const __authTestUtils = {
  createLoginMessage,
  parseToken,
  chainIdToRpcUrl,
  EIP1271_MAGIC_VALUE,
  EIP1271_ABI,
};
