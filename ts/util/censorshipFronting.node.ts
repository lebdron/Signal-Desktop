// Local patch: domain fronting for Desktop's non-libsignal requests (storage service and
// attachment CDNs), as Signal-iOS does with censorship circumvention on. libsignal fronts
// chat, CDSI and SVR itself once Net.setCensorshipCircumventionEnabled(true) is called.
//
// A fronted request connects to an innocuous host on the same CDN (the TLS name and the
// certificate check are for that host) and names Signal's reflector in the Host header,
// which travels inside TLS. The first path segment tells the reflector which Signal
// service to forward to. Reflectors and names are copied from libsignal's
// rust/net/src/env.rs and Signal-iOS's TSConstants.swift.

import type { RequestInit, Response } from 'node-fetch';
import fetch from 'node-fetch';

import { createLogger } from '../logging/log.std.ts';

const log = createLogger('censorshipFronting');

type Reflector = Readonly<{ host: string; fronts: ReadonlyArray<string> }>;

const REFLECTORS: ReadonlyArray<Reflector> = [
  {
    host: 'reflector-signal.global.ssl.fastly.net',
    fronts: ['github.githubassets.com', 'pinterest.com', 'www.redditstatic.com'],
  },
  {
    host: 'reflector-nrgwuv7kwq-uc.a.run.app',
    fronts: [
      'www.google.com',
      'android.clients.google.com',
      'clients3.google.com',
      'clients4.google.com',
      'googlemail.com',
    ],
  },
];

// Only production hosts: staging and mock servers are never fronted.
const PREFIX_BY_ORIGIN: Readonly<Record<string, string>> = {
  'https://storage.signal.org': 'storage',
  'https://cdn.signal.org': 'cdn',
  'https://cdn2.signal.org': 'cdn2',
  'https://cdn3.signal.org': 'cdn3',
};

export type FrontedTarget = Readonly<{ url: string; hostHeader: string; front: string }>;

/**
 * The fronted forms of `url`, one per reflector, in the order to try them. Empty when the
 * URL is not a Signal service the reflectors forward.
 */
export function frontedTargets(url: string): ReadonlyArray<FrontedTarget> {
  const parsed = new URL(url);
  const prefix = PREFIX_BY_ORIGIN[parsed.origin];
  if (prefix === undefined) {
    return [];
  }
  return REFLECTORS.map(reflector => {
    const front =
      reflector.fronts[Math.floor(Math.random() * reflector.fronts.length)] ??
      reflector.host;
    return {
      url: `https://${front}/${prefix}${parsed.pathname}${parsed.search}`,
      hostHeader: reflector.host,
      front,
    };
  });
}

function isRepeatableBody(body: RequestInit['body']): boolean {
  return body == null || typeof body === 'string' || Buffer.isBuffer(body);
}

/**
 * `fetch(url, init)`, through the reflectors when `enabled` and `url` is frontable.
 *
 * Tries each reflector in turn on a connection failure. A streamed body can only be sent
 * once, so such a request gets one attempt, through the first reflector. HTTP error
 * responses are returned as they are: they came from Signal, through the front.
 */
export async function fetchMaybeFronted(
  url: string,
  init: RequestInit,
  enabled: boolean
): Promise<Response> {
  const targets = enabled ? frontedTargets(url) : [];
  if (targets.length === 0) {
    return fetch(url, init);
  }

  const attempts = isRepeatableBody(init.body) ? targets : targets.slice(0, 1);
  let lastError: unknown;
  for (const target of attempts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fetch(target.url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Host: target.hostHeader },
      });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        throw error;
      }
      lastError = error;
      log.warn(`fronted request via ${target.front} failed: ${(error as Error)?.message}`);
    }
  }
  throw lastError;
}
