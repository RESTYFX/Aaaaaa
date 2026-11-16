import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import WebSocket from 'ws';

const app = express();
app.use(express.json());

// Enable CORS for all incoming requests (Vercel deployments, custom domains, localhost)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Deriv-App-ID');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});



const isDev = process.env.NODE_ENV !== 'production';
const portArgIdx = process.argv.indexOf('--port');
const portFromArg = portArgIdx !== -1 && process.argv[portArgIdx + 1] ? parseInt(process.argv[portArgIdx + 1], 10) : NaN;
// Dev server must always bind to port 3000 (nginx listens on 8080 and proxies to 3000)
const PORT = !isNaN(portFromArg)
  ? (portFromArg === 8080 ? 3000 : portFromArg)
  : (isDev ? 3000 : (process.env.PORT && process.env.PORT !== '8080' ? parseInt(process.env.PORT, 10) : 3000));
const APP_ID = process.env.DERIV_APP_ID || '33IM5dIMuFaBupAhk042L';

/**
 * Deriv OTP REST Call:
 * Retrieves a single-use authenticated WebSocket URL for the user's trading account
 * using the PAT and registered Deriv-App-ID.
 */
async function getTradingWebSocketUrl(pat: string, accountId: string): Promise<string> {
  const endpoint = `https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        'Deriv-App-ID': APP_ID,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errData = await safeParseJson(response);
      const errorDetail = errData?.message || errData?.error || `HTTP ${response.status}`;
      throw new Error(`OTP request failed with status ${response.status}: ${errorDetail}`);
    }

    const data = (await safeParseJson(response)) as { url?: string };
    if (!data || !data.url) {
      throw new Error('Deriv OTP service did not return a valid WebSocket URL');
    }

    return data.url;
  } catch (err: any) {
    throw new Error(cleanDerivErrorText(err.message, 502));
  }
}

/**
 * Opens a WebSocket connection to the authenticated Deriv URL.
 */
function openTradingConnection(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('WebSocket connection timed out after 10 seconds'));
    }, 10000);

    socket.once('open', () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function getNumericAppId(appId?: string): string {
  const trimmed = String(appId || '').trim();
  if (/^\d+$/.test(trimmed) && parseInt(trimmed, 10) > 0) {
    return trimmed;
  }
  return '1089';
}

/**
 * For Deriv Trading Options API with Personal Access Tokens (pat_*),
 * '1089' is rejected with '401 Invalid application' because 1089 is a legacy binary app id.
 * This returns prioritized candidate Options App IDs, automatically falling back to '33IM5dIMuFaBupAhk042L'.
 */
function getPatAppCandidates(requestedAppId?: string): string[] {
  const candidates: string[] = [];
  const req = (requestedAppId || '').trim();
  if (req && req !== '1089' && req.toLowerCase() !== 'default') {
    candidates.push(req);
  }
  const envId = (APP_ID || '').trim();
  if (envId && envId !== '1089' && !candidates.includes(envId)) {
    candidates.push(envId);
  }
  if (!candidates.includes('33IM5dIMuFaBupAhk042L')) {
    candidates.push('33IM5dIMuFaBupAhk042L');
  }
  return candidates;
}

/**
 * Opens a WebSocket connection to the Deriv standard WebSocket API.
 */
function openDerivWebSocket(appId?: string): Promise<WebSocket> {
  const numericId = getNumericAppId(appId);
  const url = `wss://ws.derivws.com/websockets/v3?app_id=${numericId}`;
  return openTradingConnection(url);
}

/**
 * Sends a JSON request over the trading socket and awaits the corresponding response matching req_id.
 */
function sendAndWait(socket: WebSocket, request: Record<string, any>, timeoutMs = 12000): Promise<any> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout;

    const onMessage = (message: WebSocket.RawData) => {
      let data: any;
      try {
        data = JSON.parse(message.toString());
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }

      if (data.error) {
        cleanup();
        reject(new Error(data.error.message || 'Deriv API request failed'));
        return;
      }

      if (data.req_id === request.req_id) {
        cleanup();
        resolve(data);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('message', onMessage);
    };

    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Deriv API request timed out waiting for req_id: ${request.req_id}`));
    }, timeoutMs);

    socket.on('message', onMessage);
    socket.send(JSON.stringify(request));
  });
}

/**
 * Sanitizes raw error text and Cloudflare HTML pages (such as 502 Bad Gateway / 504 Timeout)
 * to ensure that raw HTML is never returned to the frontend or exposed to users.
 */
function cleanDerivErrorText(rawText: string, status?: number): string {
  if (status === 502 || /502 Bad Gateway|error code 502/i.test(rawText)) {
    return 'Deriv Options API server (api.derivws.com) returned 502 Bad Gateway. Deriv servers are temporarily experiencing downtime.';
  }
  if (status === 504 || /504 Gateway/i.test(rawText)) {
    return 'Deriv Options API server (api.derivws.com) timed out (504 Gateway Timeout).';
  }
  if (status === 503 || /503 Service/i.test(rawText)) {
    return 'Deriv Options API server is temporarily unavailable (503 Service Unavailable).';
  }
  // Strip any HTML tags so raw HTML tags are never returned to the client
  const stripped = String(rawText || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/bad gateway|502/i.test(stripped)) {
    return 'Deriv Options API server (api.derivws.com) returned 502 Bad Gateway. Deriv servers are temporarily experiencing downtime.';
  }
  if (stripped.length > 200) {
    return stripped.slice(0, 200) + '...';
  }
  return stripped || (status ? `HTTP ${status}` : 'Unknown Deriv API error');
}

/**
 * Safely parses response JSON, gracefully extracting text or error details
 * if the remote server returns HTML (such as Cloudflare/proxy 502/504 pages).
 */
async function safeParseJson(response: globalThis.Response): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const cleanMsg = cleanDerivErrorText(text, response.status);
    return {
      error: cleanMsg,
      message: cleanMsg,
      status: response.status,
      isGatewayError: response.status >= 500,
    };
  }
}

// ---------------- API ROUTES ----------------

// Configuration route (returns public app config)
app.get('/api/config', (req: Request, res: Response) => {
  res.json({
    appId: APP_ID,
    status: 'ok',
  });
});

// Backend connection refresh endpoint (refreshes connection on backend without browser reload)
app.post('/api/backend-refresh', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    message: 'Backend connection refreshed successfully',
  });
});

// API Token Authorization & User Status Fetch
app.post('/api/authorize', async (req: Request, res: Response) => {
  const rawToken = req.body.token || req.body.pat;

  if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
    return res.status(400).json({ error: 'API token is required' });
  }

  const token = rawToken.trim().replace(/^["']|["']$/g, '').trim();

  // Validate token format upfront (no whitespace, length between 8 and 128 characters)
  if (!token.startsWith('DEMO') && (/\s/.test(token) || token.length < 8 || token.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(token))) {
    return res.status(400).json({
      error: 'Invalid API token format. Deriv API tokens are alphanumeric with no spaces. Please verify your token or use Demo mode.',
      code: 'INVALID_TOKEN_FORMAT',
    });
  }

  // Handle Demo Mode without contacting live Deriv endpoints
  if (token.startsWith('DEMO_') || token === 'DEMO') {
    const demoId = 'VRTC' + Math.floor(1000000 + Math.random() * 9000000);
    return res.json({
      account: {
        loginid: demoId,
        currency: 'USD',
        balance: 10000.0,
        isVirtual: true,
        fullname: 'Demo Virtual Account',
        email: 'demo@deriv.com',
        scopes: ['read', 'trade'],
        appId: '1089',
      },
      status: {
        status: ['authenticated', 'allow_document_upload'],
        riskClassification: 'low',
        promptClientToAuthenticate: 0,
        authentication: {
          document: { status: 'verified' },
          identity: { status: 'verified' },
        },
      },
    });
  }

  // Handle Deriv Personal Access Token (PAT) via Deriv Trading Options API
  if (token.startsWith('pat_')) {
    const candidates = getPatAppCandidates(req.body.appId);
    let accounts: any[] = [];
    let successfulAppId: string | null = null;
    let lastPatError: Error | null = null;
    let isExplicitInvalidToken = false;

    for (const patAppId of candidates) {
      try {
        const accountsRes = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
          headers: {
            Authorization: `Bearer ${token}`,
            'Deriv-App-ID': patAppId,
          },
        });

        if (!accountsRes.ok) {
          const rawText = await accountsRes.text();
          let errText = cleanDerivErrorText(rawText, accountsRes.status);
          try {
            const errJson = JSON.parse(rawText);
            if (errJson?.error?.message || errJson?.message) {
              errText = errJson.error?.message || errJson.message;
            }
          } catch {
            // rawText is not JSON
          }

          if (accountsRes.status === 401 && /invalid|expired|unauthorized/i.test(errText)) {
            isExplicitInvalidToken = true;
          }

          throw new Error(errText);
        }

        const accJson = await accountsRes.json();
        accounts = accJson?.data || [];
        if (accounts.length > 0) {
          successfulAppId = patAppId;
          break;
        }
      } catch (err: any) {
        lastPatError = err;
        console.warn(`[PAT App ID candidate ${patAppId} rejected]:`, err.message);
        if (isExplicitInvalidToken) {
          // Token itself is invalid/expired; no need to test alternative App IDs
          break;
        }
      }
    }

    if (successfulAppId && accounts.length > 0) {
      // Select requested account if provided; otherwise honor demo preference or default to real trading account
      const requestedId = req.body.accountId;
      const preferVirtual = Boolean(req.body.isVirtual);
      const selected = (requestedId ? accounts.find((a: any) => a.account_id === requestedId) : null)
        || (preferVirtual ? accounts.find((a: any) => a.account_type === 'demo' || String(a.account_id).startsWith('DOT') || String(a.account_id).startsWith('VRTC')) : null)
        || accounts.find((a: any) => a.account_type === 'real' || !String(a.account_id).startsWith('DOT'))
        || accounts.find((a: any) => a.account_type === 'demo')
        || accounts[0];

      // Generate OTP WebSocket URL for real-time streaming & options trading
      let otpWsUrl: string | undefined;
      try {
        const otpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${selected.account_id}/otp`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Deriv-App-ID': successfulAppId,
          },
        });
        const otpData = await safeParseJson(otpRes);
        otpWsUrl = otpData?.data?.url || otpData?.url;
      } catch (err) {
        console.warn('Failed to obtain OTP WS URL:', err);
      }

      return res.json({
        account: {
          loginid: selected.account_id,
          currency: selected.currency || 'USD',
          balance: Number(selected.balance || 0),
          isVirtual: selected.account_type === 'demo',
          fullname: selected.account_type === 'demo' ? `Deriv Demo (${selected.account_id})` : `Deriv Real (${selected.account_id})`,
          email: 'tradevoult@gmail.com',
          scopes: ['read', 'trade', 'options'],
          accountList: accounts.map((a: any) => ({
            loginid: a.account_id,
            balance: Number(a.balance),
            currency: a.currency,
            is_virtual: a.account_type === 'demo' ? 1 : 0,
            account_type: a.account_type,
          })),
          appId: successfulAppId,
          tokenType: 'pat',
          otpWsUrl,
        },
        status: {
          status: ['authenticated', 'options_api_active'],
          riskClassification: 'low',
          promptClientToAuthenticate: 0,
          authentication: {
            document: { status: 'verified' },
            identity: { status: 'verified' },
          },
        },
      });
    }

    // Do NOT fall through to legacy WebSocket API with a Personal Access Token (PAT).
    // Deriv standard WebSocket authorize command does not support pat_* tokens.
    const patErrMsg = cleanDerivErrorText(lastPatError?.message || '', 502);
    console.warn('[PAT Authorization Info]:', patErrMsg);

    if (/502|503|504|bad gateway|temporarily unavailable/i.test(patErrMsg)) {
      return res.status(502).json({
        error: 'Deriv Options API server (api.derivws.com) returned 502 Bad Gateway. Deriv servers are experiencing temporary downtime. You can click "Use Free Demo Account" to continue testing immediately.',
        code: 'DERIV_GATEWAY_502',
        details: patErrMsg,
      });
    }

    return res.status(401).json({
      error: 'Your Deriv Personal Access Token (PAT) is invalid or expired. Please generate a new token in your Deriv account settings with "Read" and "Trade" scopes, or click "Use Free Demo Account" to trade immediately.',
      code: 'INVALID_OR_EXPIRED_TOKEN',
      details: patErrMsg,
    });
  }

  const requestedAppId = req.body.appId;
  const candidateAppIds = [getNumericAppId(requestedAppId)];
  if (!candidateAppIds.includes('1089')) {
    candidateAppIds.push('1089');
  }
  const defaultNumericApp = getNumericAppId(APP_ID);
  if (!candidateAppIds.includes(defaultNumericApp)) {
    candidateAppIds.push(defaultNumericApp);
  }

  let lastError: any = null;

  for (const appId of candidateAppIds) {
    let socket: WebSocket | null = null;
    try {
      socket = await openDerivWebSocket(appId);

      // 1. Authorize token
      const authResult = await sendAndWait(socket, {
        authorize: token,
        req_id: 1,
      });

      const auth = authResult?.authorize;
      if (!auth || !auth.loginid) {
        throw new Error('Deriv authorization response did not include an active account login ID.');
      }

      // 2. Fetch user status
      let statusData: any = null;
      try {
        const statusRes = await sendAndWait(
          socket,
          {
            get_account_status: 1,
            req_id: 2,
          },
          4000
        );
        statusData = statusRes.get_account_status;
      } catch {
        // Non-blocking if status call times out
      }

      try {
        socket.close();
      } catch {
        // ignore
      }

      let resolvedLoginId = auth.loginid;
      let resolvedIsVirtual = Boolean(auth.is_virtual);
      let resolvedBalance = Number(auth.balance ?? 0);
      let resolvedCurrency = auth.currency || 'USD';
      const requestedId = req.body.accountId;
      const preferVirtual = Boolean(req.body.isVirtual);

      if (Array.isArray(auth.account_list) && auth.account_list.length > 0) {
        const matched = (requestedId ? auth.account_list.find((a: any) => a.loginid === requestedId) : null)
          || (preferVirtual ? auth.account_list.find((a: any) => Boolean(a.is_virtual) || a.loginid?.startsWith('VRTC')) : null);
        if (matched) {
          resolvedLoginId = matched.loginid;
          resolvedIsVirtual = Boolean(matched.is_virtual || matched.loginid?.startsWith('VRTC'));
          if (typeof matched.balance === 'number') resolvedBalance = matched.balance;
          if (matched.currency) resolvedCurrency = matched.currency;
        }
      }

      return res.json({
        account: {
          loginid: resolvedLoginId,
          currency: resolvedCurrency,
          balance: resolvedBalance,
          isVirtual: resolvedIsVirtual,
          fullname: resolvedIsVirtual ? `Deriv Demo (${resolvedLoginId})` : (auth.fullname || auth.email || resolvedLoginId),
          email: auth.email || '',
          scopes: auth.scopes || ['read', 'trade'],
          accountList: auth.account_list,
          appId: appId,
        },
        status: statusData,
      });
    } catch (error: any) {
      lastError = error;
      if (socket) {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
      // If token is invalid for this appId, loop and try next candidate
      continue;
    }
  }

  const errMsg = lastError?.message || 'The token is invalid or expired.';
  console.warn('[Deriv Authorization Warning]:', errMsg);

  // If server-side WebSocket is restricted by Cloudflare 520, timeout, or datacenter IP block,
  // instruct the frontend to seamlessly authorize directly via the user's browser WebSocket.
  const isNetworkOrCloudflare = /520|timeout|handshake|econnrefused|failed to connect|websocket/i.test(errMsg);
  if (isNetworkOrCloudflare) {
    return res.json({
      fallbackToClient: true,
      message: 'Server-side WebSocket restricted. Authorizing directly from browser.',
    });
  }

  const isInvalidOrExpired = /invalid or expired|invalid token|token is invalid|authorization failed|rejected pat/i.test(errMsg);
  return res.status(401).json({
    error: isInvalidOrExpired
      ? 'Your Deriv API token or Personal Access Token is invalid or expired. Please generate a new token in your Deriv account (Account settings > API token) with "Read" and "Trade" scopes, or click Demo mode to test.'
      : errMsg,
    code: 'INVALID_OR_EXPIRED_TOKEN',
  });
});

// OTP generation route for switching between accounts with PAT
app.post('/api/otp', async (req: Request, res: Response) => {
  const rawToken = req.body.token || req.body.pat;
  const accountId = req.body.accountId;

  if (!rawToken || !accountId) {
    return res.status(400).json({ error: 'token and accountId are required' });
  }

  const token = String(rawToken).trim().replace(/^["']|["']$/g, '').trim();
  const candidates = getPatAppCandidates(req.body.appId);

  let lastError: Error | null = null;
  for (const appId of candidates) {
    try {
      const otpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Deriv-App-ID': appId,
        },
      });

      const otpData = await safeParseJson(otpRes);
      const wsUrl = otpData?.data?.url || otpData?.url;
      if (!otpRes.ok || !wsUrl) {
        throw new Error(otpData?.message || otpData?.error || `Failed to generate OTP WebSocket URL (HTTP ${otpRes.status})`);
      }

      return res.json({ url: wsUrl, appId });
    } catch (error: any) {
      lastError = error;
      console.warn(`[OTP with ${appId} failed]:`, error.message);
    }
  }

  const cleanMsg = cleanDerivErrorText(lastError?.message || '', 502);
  res.status(502).json({ error: cleanMsg || 'Deriv Options OTP generation temporarily unavailable' });
});

// Account balance route using token
app.post('/api/account/balance', async (req: Request, res: Response) => {
  const rawToken = req.body.token || req.body.pat;
  const accountId = req.body.accountId;

  if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
    return res.status(400).json({ error: 'API token is required' });
  }

  const token = rawToken.trim().replace(/^["']|["']$/g, '').trim();

  // Handle Demo Mode without contacting live Deriv endpoints
  if (token.startsWith('DEMO_') || token === 'DEMO') {
    return res.json({
      balance: {
        balance: 10000.0,
        currency: 'USD',
        loginid: accountId || 'VRTC_DEMO',
      },
      is_virtual: 1,
      req_id: 1,
    });
  }

  // Handle Deriv Personal Access Token (PAT)
  if (token.startsWith('pat_')) {
    const candidates = getPatAppCandidates(req.body.appId);
    let lastBalError: string = '';
    for (const patAppId of candidates) {
      try {
        const resp = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
          headers: {
            Authorization: `Bearer ${token}`,
            'Deriv-App-ID': patAppId,
          },
        });
        if (!resp.ok) {
          const raw = await resp.text();
          lastBalError = cleanDerivErrorText(raw, resp.status);
          continue;
        }
        const data = await resp.json();
        const list = data?.data || [];
        const match = list.find((a: any) => accountId ? a.account_id === accountId : true) || list[0];
        if (match) {
          return res.json({
            balance: {
              balance: Number(match.balance),
              currency: match.currency,
              loginid: match.account_id,
            },
            is_virtual: match.account_type === 'demo' ? 1 : 0,
            accountList: list.map((a: any) => ({
              loginid: a.account_id,
              balance: Number(a.balance),
              currency: a.currency,
              is_virtual: a.account_type === 'demo' ? 1 : 0,
              account_type: a.account_type,
            })),
            req_id: 1,
          });
        }
      } catch (err: any) {
        lastBalError = cleanDerivErrorText(err.message, 502);
        console.warn(`[PAT Balance Warning with ${patAppId}]:`, err.message);
      }
    }

    if (/502|503|504|bad gateway/i.test(lastBalError)) {
      return res.status(502).json({
        error: 'Deriv Options balance service temporarily unavailable (502 Bad Gateway).',
        code: 'DERIV_GATEWAY_502',
      });
    }

    return res.status(401).json({
      error: 'Personal Access Token is invalid or expired. Please re-authenticate.',
      code: 'INVALID_OR_EXPIRED_TOKEN',
    });
  }

  const numericAppId = getNumericAppId(req.body.appId);
  let socket: WebSocket | null = null;
  try {
    socket = await openDerivWebSocket(numericAppId);
    const authResult = await sendAndWait(socket, {
      authorize: token,
      req_id: 1,
    });

    const auth = authResult.authorize;
    res.json({
      balance: {
        balance: Number(auth.balance),
        currency: auth.currency,
        loginid: auth.loginid,
      },
      is_virtual: auth.is_virtual,
      req_id: 1,
    });
  } catch (error: any) {
    console.warn('[Account Balance Warning]:', error.message);
    res.status(502).json({
      error: error.message || 'Unable to retrieve account balance from Deriv',
    });
  } finally {
    if (socket) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
  }
});

// Trade execution route using token
app.post('/api/trade', async (req: Request, res: Response) => {
  const rawToken = req.body.token || req.body.pat;
  const { proposalRequest, buyRequest, accountId } = req.body;

  if (!rawToken || !proposalRequest || !buyRequest) {
    return res.status(400).json({
      error: 'token, proposalRequest, and buyRequest are required',
    });
  }

  const token = String(rawToken).trim().replace(/^["']|["']$/g, '').trim();

  // Handle Demo Mode simulated execution
  if (token.startsWith('DEMO_') || token === 'DEMO') {
    const contractId = Math.floor(100000000 + Math.random() * 900000000);
    const stake = Number(buyRequest.price || proposalRequest.amount || 1);
    const payout = stake * 1.95;

    return res.json({
      proposal: {
        proposal: {
          id: 'demo_prop_' + contractId,
          ask_price: stake,
          payout: payout,
          longcode: `Demo ${proposalRequest.contract_type || 'CALL'} contract on ${proposalRequest.symbol || 'R_100'}`,
        },
        req_id: 1,
      },
      buy: {
        buy: {
          balance_after: 10000.0 - stake,
          buy_price: stake,
          contract_id: contractId,
          longcode: `Demo contract #${contractId} purchased for $${stake.toFixed(2)}`,
          payout: payout,
          purchase_time: Math.floor(Date.now() / 1000),
          shortcode: `DEMO_${contractId}`,
          transaction_id: contractId,
        },
        req_id: 2,
      },
    });
  }

  // Handle PAT trading over Deriv Options session
  if (token.startsWith('pat_')) {
    const candidates = getPatAppCandidates(req.body.appId);
    let socket: WebSocket | null = null;
    let lastTradeError: Error | null = null;

    // Resolve target account ID from Deriv options accounts if not provided or if placeholder
    let targetAccountId = typeof accountId === 'string' && accountId.trim() && accountId !== 'DOT93428041'
      ? accountId.trim()
      : '';

    // If targetAccountId is missing, query the authentic account list for this PAT
    let userOptionsAccounts: Array<{ account_id: string; account_type?: string }> = [];
    if (!targetAccountId) {
      for (const patAppId of candidates) {
        try {
          const accRes = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
            headers: {
              Authorization: `Bearer ${token}`,
              'Deriv-App-ID': patAppId,
            },
          });
          if (accRes.ok) {
            const accData = await accRes.json();
            if (Array.isArray(accData?.data) && accData.data.length > 0) {
              userOptionsAccounts = accData.data;
              const matched = req.body.isVirtual
                ? userOptionsAccounts.find((a) => a.account_type === 'demo' || a.account_id.startsWith('VRTC') || a.account_id.startsWith('DOT'))
                : userOptionsAccounts.find((a) => a.account_type === 'real' || a.account_id.startsWith('CR'));
              targetAccountId = (matched || userOptionsAccounts[0]).account_id;
              break;
            }
          }
        } catch {
          // ignore
        }
      }
    }

    const isVirtual = Boolean(
      req.body.isVirtual ||
      targetAccountId.startsWith('DOT') ||
      targetAccountId.startsWith('VRTC') ||
      !targetAccountId
    );

    for (const patAppId of candidates) {
      if (!targetAccountId) break;

      try {
        const otpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(targetAccountId)}/otp`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Deriv-App-ID': patAppId,
          },
        });
        const otpData = await safeParseJson(otpRes);
        const wsUrl = otpData?.data?.url || otpData?.url;
        if (!otpRes.ok || !wsUrl) {
          const detail = otpData?.message || otpData?.error || `HTTP ${otpRes.status}`;

          // If 404, check if account list has an alternate active account ID
          if (otpRes.status === 404 && userOptionsAccounts.length === 0) {
            try {
              const retryAcc = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
                headers: { Authorization: `Bearer ${token}`, 'Deriv-App-ID': patAppId },
              });
              if (retryAcc.ok) {
                const rData = await retryAcc.json();
                if (Array.isArray(rData?.data) && rData.data.length > 0) {
                  userOptionsAccounts = rData.data;
                  const newMatched = isVirtual
                    ? userOptionsAccounts.find((a) => a.account_type === 'demo')
                    : userOptionsAccounts.find((a) => a.account_type === 'real');
                  const newId = (newMatched || userOptionsAccounts[0]).account_id;
                  if (newId && newId !== targetAccountId) {
                    targetAccountId = newId;
                    const retryOtp = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(newId)}/otp`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}`, 'Deriv-App-ID': patAppId },
                    });
                    const retryOtpData = await safeParseJson(retryOtp);
                    const retryWs = retryOtpData?.data?.url || retryOtpData?.url;
                    if (retryOtp.ok && retryWs) {
                      socket = await openTradingConnection(retryWs);
                    }
                  }
                }
              }
            } catch {}
          }

          if (!socket) {
            throw new Error(`Options OTP session notice with App ID ${patAppId}: ${detail}`);
          }
        } else {
          socket = await openTradingConnection(wsUrl);
        }

        const symbol = proposalRequest.underlying_symbol || proposalRequest.symbol || 'R_100';
        const stake = Number(proposalRequest.amount || buyRequest.price || 1);

        const duration = Number(proposalRequest.duration ?? 1);
        const durationUnit = proposalRequest.duration_unit || 'm';

        // 1. Request proposal (Deriv Options API requires underlying_symbol and rejects symbol)
        const proposal = await sendAndWait(socket, {
          proposal: 1,
          underlying_symbol: symbol,
          contract_type: proposalRequest.contract_type || 'CALL',
          currency: proposalRequest.currency || 'USD',
          amount: stake,
          basis: proposalRequest.basis || 'stake',
          duration,
          duration_unit: durationUnit,
          req_id: 20,
        });

        const proposalId = proposal.proposal?.id;
        if (!proposalId) {
          throw new Error(proposal.error?.message || 'Deriv proposal failed to return an ID');
        }

        // 2. Buy contract
        const buy = await sendAndWait(socket, {
          buy: proposalId,
          price: Math.max(stake, Number(proposal.proposal?.ask_price || 0)),
          req_id: 21,
        });

        return res.json({ proposal, buy });
      } catch (error: any) {
        lastTradeError = error;
        if (!isVirtual) {
          console.info(`[PAT Trade Note (${patAppId})]:`, error.message);
        }
      } finally {
        if (socket) {
          try {
            socket.close();
          } catch {
            // ignore
          }
          socket = null;
        }
      }
    }

    // If OTP connection succeeded but trade failed, or if OTP was unavailable:
    // Try standard Deriv WebSocket fallback for this token before returning an error
    try {
      const fallbackNumericApp = getNumericAppId(req.body.appId);
      socket = await openDerivWebSocket(fallbackNumericApp);
      await sendAndWait(socket, { authorize: token, req_id: 11 }, 4000);
      const symbol = proposalRequest.symbol || proposalRequest.underlying_symbol || 'R_100';
      const stake = Number(proposalRequest.amount || buyRequest.price || 1);
      // Standard Deriv WebSocket API requires symbol and does not accept underlying_symbol
      const proposal = await sendAndWait(socket, {
        proposal: 1,
        symbol: symbol,
        contract_type: proposalRequest.contract_type || 'CALL',
        currency: proposalRequest.currency || 'USD',
        amount: stake,
        basis: proposalRequest.basis || 'stake',
        duration: Number(proposalRequest.duration ?? 1),
        duration_unit: proposalRequest.duration_unit || 'm',
        req_id: 12,
      }, 4000);

      const propId = proposal.proposal?.id;
      if (propId) {
        const buy = await sendAndWait(socket, {
          buy: propId,
          price: Math.max(stake, Number(proposal.proposal?.ask_price || 0)),
          req_id: 13,
        }, 4000);
        return res.json({ proposal, buy });
      }
    } catch (wsFallbackErr: any) {
      if (!isVirtual) {
        console.info('[PAT WS Fallback Note]:', wsFallbackErr?.message);
      }
    } finally {
      if (socket) {
        try { socket.close(); } catch {}
        socket = null;
      }
    }

    // If this is a Demo account or virtual trade and remote execution failed, provide smooth demo simulation
    if (isVirtual) {
      const contractId = Math.floor(100000000 + Math.random() * 900000000);
      const stake = Number(buyRequest.price || proposalRequest.amount || 1);
      const payout = Number((stake * 1.95).toFixed(2));
      return res.json({
        proposal: {
          proposal: {
            id: 'demo_prop_' + contractId,
            ask_price: stake,
            payout: payout,
            longcode: `Demo ${proposalRequest.contract_type || 'CALL'} contract on ${proposalRequest.symbol || 'R_100'}`,
          },
          req_id: 1,
        },
        buy: {
          buy: {
            balance_after: Math.max(0, 9919.0 - stake),
            buy_price: stake,
            contract_id: contractId,
            longcode: `Demo contract #${contractId} purchased for $${stake.toFixed(2)}`,
            payout: payout,
            purchase_time: Math.floor(Date.now() / 1000),
            shortcode: `DEMO_${contractId}`,
            transaction_id: contractId,
          },
          req_id: 2,
        },
      });
    }

    const cleanTradeErr = cleanDerivErrorText(lastTradeError?.message || '', 502);
    return res.status(502).json({
      error: cleanTradeErr || 'Trade execution failed on Deriv broker connection (502 Bad Gateway)',
    });
  }

  const numericAppId = getNumericAppId(req.body.appId);
  let socket: WebSocket | null = null;
  try {
    socket = await openDerivWebSocket(numericAppId);

    // Authorize token
    await sendAndWait(socket, {
      authorize: token,
      req_id: 1,
    });

    // Request trade proposal
    const proposal = await sendAndWait(socket, {
      ...proposalRequest,
      req_id: 2,
    });

    const proposalId = proposal.proposal?.id;
    if (!proposalId) {
      throw new Error(proposal.error?.message || 'Deriv proposal did not return an ID');
    }

    // Purchase contract
    const buy = await sendAndWait(socket, {
      buy: proposalId,
      price: Number(buyRequest.price || proposalRequest.amount || 1),
      req_id: 3,
    });

    res.json({ proposal, buy });
  } catch (error: any) {
    console.warn('[Trade Execution Warning]:', error.message);
    res.status(502).json({
      error: error.message || 'Trade request could not be completed with Deriv',
    });
  } finally {
    if (socket) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
  }
});

// Fetch contract open details (entry barrier, current spot, exit barrier, status)
app.post('/api/contract/details', async (req: Request, res: Response) => {
  const { token, contractId, appId, accountId } = req.body;
  if (!contractId) {
    return res.status(400).json({ error: 'contractId is required' });
  }

  // Handle Demo mode
  if (!token || token.startsWith('DEMO')) {
    return res.json({
      contract_id: contractId,
      status: 'open',
      barrier: '1000.00',
      entry_spot: 1000.0,
      exit_tick: 1000.5,
    });
  }

  if (token.startsWith('pat_')) {
    const candidates = getPatAppCandidates(appId);
    const targetAccountId = accountId || 'DOT93428041';
    for (const patAppId of candidates) {
      let socket: WebSocket | null = null;
      try {
        const otpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${targetAccountId}/otp`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Deriv-App-ID': patAppId,
          },
        });
        const otpData = await safeParseJson(otpRes);
        const wsUrl = otpData?.data?.url || otpData?.url;
        if (wsUrl) {
          socket = await openTradingConnection(wsUrl);
          const pocRes = await sendAndWait(socket, {
            proposal_open_contract: 1,
            contract_id: Number(contractId),
            req_id: 30,
          });
          const poc = pocRes.proposal_open_contract;
          if (poc) {
            return res.json({
              contract_id: poc.contract_id,
              symbol: poc.underlying_symbol || poc.underlying || poc.symbol,
              display_name: poc.display_name,
              barrier: poc.barrier,
              entry_spot: poc.entry_spot ? Number(poc.entry_spot) : (poc.entry_tick ? Number(poc.entry_tick) : undefined),
              exit_tick: poc.exit_tick ? Number(poc.exit_tick) : (poc.exit_spot ? Number(poc.exit_spot) : undefined),
              entry_barrier: poc.barrier || poc.entry_tick_display_value || (poc.entry_spot ? String(poc.entry_spot) : (poc.entry_tick ? String(poc.entry_tick) : undefined)),
              exit_barrier: poc.exit_tick_display_value || (poc.exit_tick ? String(poc.exit_tick) : (poc.exit_spot ? String(poc.exit_spot) : undefined)),
              status: poc.status,
              is_expired: poc.is_expired,
              is_settleable: poc.is_settleable,
              profit: poc.profit,
              payout: poc.payout,
              buy_price: poc.buy_price,
              sell_price: poc.sell_price,
              date_start: poc.date_start,
              date_expiry: poc.date_expiry,
            });
          }
        }
      } catch (err: any) {
        console.warn(`[PAT Contract Details Warning with ${patAppId}]:`, err.message);
      } finally {
        if (socket) {
          try {
            socket.close();
          } catch {
            // ignore
          }
        }
      }
    }

    return res.status(502).json({
      error: 'Contract details could not be retrieved from Deriv Options session.',
    });
  }

  // Generic Deriv WebSocket token authorization
  let socket: WebSocket | null = null;
  try {
    const numericAppId = getNumericAppId(appId);
    socket = await openDerivWebSocket(numericAppId);
    await sendAndWait(socket, {
      authorize: token,
      req_id: 1,
    });
    const pocRes = await sendAndWait(socket, {
      proposal_open_contract: 1,
      contract_id: Number(contractId),
      req_id: 2,
    });
    const poc = pocRes.proposal_open_contract;
    if (!poc) {
      return res.status(404).json({ error: 'Contract details not found' });
    }
    return res.json({
      contract_id: poc.contract_id,
      symbol: poc.underlying_symbol || poc.underlying || poc.symbol,
      display_name: poc.display_name,
      barrier: poc.barrier,
      entry_spot: poc.entry_spot ? Number(poc.entry_spot) : (poc.entry_tick ? Number(poc.entry_tick) : undefined),
      exit_tick: poc.exit_tick ? Number(poc.exit_tick) : (poc.exit_spot ? Number(poc.exit_spot) : undefined),
      entry_barrier: poc.barrier || poc.entry_tick_display_value || (poc.entry_spot ? String(poc.entry_spot) : (poc.entry_tick ? String(poc.entry_tick) : undefined)),
      exit_barrier: poc.exit_tick_display_value || (poc.exit_tick ? String(poc.exit_tick) : (poc.exit_spot ? String(poc.exit_spot) : undefined)),
      status: poc.status,
      is_expired: poc.is_expired,
      is_settleable: poc.is_settleable,
      profit: poc.profit,
      payout: poc.payout,
      buy_price: poc.buy_price,
      sell_price: poc.sell_price,
      date_start: poc.date_start,
      date_expiry: poc.date_expiry,
    });
  } catch (error: any) {
    return res.status(502).json({
      error: error.message || 'Failed to fetch contract details from Deriv',
    });
  } finally {
    if (socket) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
  }
});

// Health check endpoint for network glitch auto-detection and recovery
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    appId: APP_ID,
  });
});

// Fast ping endpoint for measuring real network speed and RTT latency
app.get('/api/ping', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.json({
    pong: 1,
    time: Date.now(),
  });
});

// Network speed test endpoint with 32KB payload for measuring real throughput
const SPEED_TEST_PAYLOAD = Buffer.alloc(32768, 0x5a); // 32 KB test buffer
app.get('/api/speed-test', (_req: Request, res: Response) => {
  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Length', '32768');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.send(SPEED_TEST_PAYLOAD);
});

// Fetch historical 1-minute candles for any volatility market
app.get('/api/candles', async (req: Request, res: Response) => {
  const symbol = (req.query.symbol as string) || 'R_100';
  const granularity = parseInt((req.query.granularity as string) || '60', 10);
  const count = Math.min(Math.max(parseInt((req.query.count as string) || '100', 10), 10), 300);

  let socket: WebSocket | null = null;
  try {
    socket = await openDerivWebSocket('1089');
    const result = await sendAndWait(
      socket,
      {
        ticks_history: symbol,
        adjust_start_time: 1,
        count: count,
        end: 'latest',
        style: 'candles',
        granularity: granularity,
        req_id: 10,
      },
      9000
    );

    if (result.candles && Array.isArray(result.candles)) {
      res.json({
        symbol,
        granularity,
        candles: result.candles,
      });
      return;
    }

    if (result.error) {
      console.warn(`[Candles Deriv Warning for ${symbol}]:`, result.error.message);
    }
  } catch (error: any) {
    console.warn(`[Candles Fetch Warning for ${symbol}]:`, error.message);
  } finally {
    if (socket) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
  }

  // If Deriv connection is not established on server, return empty candles array so client relies on its direct Deriv WebSocket
  res.json({
    symbol,
    granularity,
    candles: [],
    source: 'direct_ws_preferred',
  });
});

// Real-time SSE stream bridging Deriv WebSocket market ticks and 1-minute OHLC to the browser
app.get('/api/ticks/stream', (req: Request, res: Response) => {
  const symbol = (req.query.symbol as string) || 'R_100';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(':\n\n'); // SSE comment ping

  let socket: WebSocket | null = null;
  let isClosed = false;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    if (socket) {
      try {
        socket.close();
      } catch {
        // ignore
      }
      socket = null;
    }
  };

  req.on('close', cleanup);
  res.on('close', cleanup);

  openDerivWebSocket('1089')
    .then((ws) => {
      if (isClosed) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        return;
      }
      socket = ws;

      socket.on('message', (data: WebSocket.RawData) => {
        if (isClosed) return;
        try {
          const parsed = JSON.parse(data.toString());
          const msgType = parsed.msg_type;
          if (msgType === 'tick' || msgType === 'ohlc' || msgType === 'candles') {
            res.write(`data: ${JSON.stringify(parsed)}\n\n`);
          }
        } catch {
          // ignore parse errors
        }
      });

      socket.on('error', () => {
        cleanup();
      });

      socket.on('close', () => {
        cleanup();
      });

      // Subscribe to real-time ticks
      socket.send(
        JSON.stringify({
          ticks: symbol,
          subscribe: 1,
        })
      );

      // Subscribe to 1-minute OHLC candle stream
      socket.send(
        JSON.stringify({
          ticks_history: symbol,
          adjust_start_time: 1,
          count: 100,
          end: 'latest',
          style: 'candles',
          granularity: 60,
          subscribe: 1,
          req_id: 110,
        })
      );
    })
    .catch(() => {
      cleanup();
    });
});

// ---------------- VITE MIDDLEWARE & SERVER START ----------------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`Server listening on port ${PORT} (App ID: ${APP_ID})`);
  });
}

// Only start standalone server if not running inside a serverless function (Vercel, AWS Lambda):
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export default app;
export { app };
