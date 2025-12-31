import { join, resolve } from 'node:path';
import type { Competition } from '@wca/helpers';
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  ClientSecretPost,
  Configuration,
  refreshTokenGrant,
  type ServerMetadata,
} from 'openid-client';

const TYPECOMP_DIR = resolve(process.cwd(), '.typecomp');
const TOKEN_FILE = join(TYPECOMP_DIR, 'tokens.json');
const LOCAL_WCIF_DIR = join(TYPECOMP_DIR, 'local-wcif');

interface TokenData {
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
}

let tokenData: TokenData = {};
let config: Configuration | null = null;
let env: {
  WCA_API: string;
  WCA_CLIENT: string;
  WCA_SECRET: string;
  PORT: string;
  SCHEME: string;
  HOST: string;
} | null = null;

async function loadTokens(): Promise<TokenData> {
  try {
    const file = Bun.file(TOKEN_FILE);
    if (await file.exists()) {
      tokenData = JSON.parse(await file.text()) as TokenData;
    }
  } catch {
    tokenData = {};
  }
  return tokenData;
}

async function saveTokens(): Promise<void> {
  await Bun.write(TOKEN_FILE, JSON.stringify(tokenData, null, 2));
}

function init(): void {
  env = {
    WCA_API: process.env.WCA_API || 'https://www.worldcubeassociation.org',
    WCA_CLIENT: process.env.WCA_CLIENT || '',
    WCA_SECRET: process.env.WCA_SECRET || '',
    PORT: process.env.PORT || '3030',
    SCHEME: process.env.SCHEME || 'http',
    HOST: process.env.HOST || 'localhost',
  };

  if (!env.WCA_CLIENT) {
    throw new Error('WCA_CLIENT is required. Please set it in your .env file.');
  }

  const metadata: ServerMetadata = {
    issuer: 'worldcubeassociation',
    authorization_endpoint: `${env.WCA_API}/oauth/authorize`,
    token_endpoint: `${env.WCA_API}/oauth/token`,
    userinfo_endpoint: `${env.WCA_API}/api/v0/me`,
  };

  config = new Configuration(
    metadata,
    env.WCA_CLIENT,
    { client_secret: env.WCA_SECRET },
    ClientSecretPost(env.WCA_SECRET),
  );
  config.timeout = 600;
}

function updateTokens(tokenSet: {
  refresh_token?: string;
  access_token?: string;
  expires_in?: number;
}): void {
  if (tokenSet.refresh_token) tokenData.refreshToken = tokenSet.refresh_token;
  if (tokenSet.access_token) tokenData.accessToken = tokenSet.access_token;
  if (tokenSet.expires_in)
    tokenData.expiresAt = Date.now() + tokenSet.expires_in * 1000;
}

async function fetchApi(
  url: string,
  accessToken: string,
): Promise<Competition> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok)
    throw new Error(
      `WCA API error: ${res.status} ${res.statusText} - ${await res.text()}`,
    );
  return (await res.json()) as Competition;
}

export async function login(): Promise<void> {
  init();
  await loadTokens();
  if (!env || !config) throw new Error('Initialization failed');
  const currentEnv = env;
  const currentConfig = config;

  return new Promise((resolve, reject) => {
    const port = parseInt(currentEnv.PORT, 10);
    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/auth/oauth_response') {
          try {
            const tokenSet = await authorizationCodeGrant(currentConfig, url);
            updateTokens(tokenSet);
            await saveTokens();
            server.stop();
            resolve();
            return new Response(
              '<html><body><h1>Login successful! You can close this window.</h1></body></html>',
              { headers: { 'Content-Type': 'text/html' } },
            );
          } catch (error) {
            server.stop();
            reject(error);
            return new Response(
              `<html><body><h1>Login failed: ${error}</h1></body></html>`,
              { status: 400, headers: { 'Content-Type': 'text/html' } },
            );
          }
        }
        return new Response('Not found', { status: 404 });
      },
    });

    const redirectUri = `${currentEnv.SCHEME}://${currentEnv.HOST}:${port}/auth/oauth_response`;
    const authUrl = buildAuthorizationUrl(currentConfig, {
      redirect_uri: redirectUri,
      scope: 'public manage_competitions',
    });
    console.log(authUrl.href);
    const cmd =
      process.platform === 'darwin'
        ? ['open', authUrl.href]
        : process.platform === 'win32'
          ? ['cmd', '/c', 'start', authUrl.href]
          : ['xdg-open', authUrl.href];
    Bun.spawn(cmd, { onExit: () => {} });
  });
}

export async function getAccessToken(): Promise<string> {
  init();
  await loadTokens();
  if (!config) throw new Error('Initialization failed');

  if (!tokenData.refreshToken)
    throw new Error('Not logged in. Run "bun run login" first.');

  const now = Date.now();
  if (
    tokenData.expiresAt &&
    now < tokenData.expiresAt - 5 * 60 * 1000 &&
    tokenData.accessToken
  ) {
    return tokenData.accessToken;
  }

  try {
    const tokenSet = await refreshTokenGrant(config, tokenData.refreshToken);
    updateTokens(tokenSet);
    await saveTokens();
    if (!tokenData.accessToken)
      throw new Error('No access token received after refresh');
    return tokenData.accessToken;
  } catch (error) {
    throw new Error(
      `Failed to refresh token: ${error}. Please run "bun run login" again.`,
    );
  }
}

export async function getWcif(
  competitionId: string,
  noCache = false,
): Promise<Competition> {
  init();
  if (!env) throw new Error('Initialization failed');
  const localPath = join(LOCAL_WCIF_DIR, `${competitionId}.json`);
  const localFile = Bun.file(localPath);

  if (!noCache && (await localFile.exists())) {
    return await localFile.json();
  }

  const accessToken = await getAccessToken();
  let url = `${env.WCA_API}/api/v0/competitions/${competitionId}/wcif`;

  try {
    const wcif = await fetchApi(url, accessToken);
    await Bun.write(localPath, JSON.stringify(wcif, null, 2));
    return wcif;
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message?.includes('403') || err.message?.includes('401')) {
      url = `${env.WCA_API}/api/v0/competitions/${competitionId}/wcif/public`;
      const wcif = await fetchApi(url, accessToken);
      await Bun.write(localPath, JSON.stringify(wcif, null, 2));
      return wcif;
    }
    throw error;
  }
}

export async function patchWcif(
  competitionId: string,
  wcif: Competition,
  keys: string[],
): Promise<Competition> {
  init();
  if (!env) throw new Error('Initialization failed');
  const accessToken = await getAccessToken();
  const wcifRecord = wcif as unknown as Record<string, unknown>;
  const toPatch: Partial<Competition> = {};
  for (const key of keys)
    if (key in wcifRecord)
      (toPatch as unknown as Record<string, unknown>)[key] = wcifRecord[key];

  const res = await fetch(
    `${env.WCA_API}/api/v0/competitions/${competitionId}/wcif`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toPatch),
    },
  );

  if (!res.ok)
    throw new Error(
      `Failed to patch WCIF: ${res.status} ${res.statusText} - ${await res.text()}`,
    );

  const updated = (await res.json()) as Competition;
  const updatedRecord = updated as unknown as Record<string, unknown>;
  if (updatedRecord.persons || updatedRecord.schedule || updatedRecord.events) {
    await Bun.write(
      join(LOCAL_WCIF_DIR, `${competitionId}.json`),
      JSON.stringify(updated, null, 2),
    );
  }
  return updated;
}

export async function patchWcifWithRetries(
  competitionId: string,
  wcif: Competition,
  keys: string[],
): Promise<Competition> {
  for (let i = 0; i < 10; i++) {
    try {
      return await patchWcif(competitionId, wcif, keys);
    } catch (error: unknown) {
      if (i === 9) throw error;
      const err = error as Error & { code?: string };
      const shouldRetry =
        err.code === 'ECONNRESET' ||
        err.message?.includes('ECONNRESET') ||
        err.message?.includes('429') ||
        err.message?.includes('rate limit');
      if (!shouldRetry) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1000 * 2 ** i, 10000)),
      );
    }
  }
  throw new Error('Failed to patch WCIF after 10 retries');
}
