import type { OrderSource, Platform } from '@gocrypto/shared-types';
import { PLATFORMS } from '@gocrypto/shared-types';
import type { RequestContext } from '@gocrypto/server-core';
import type { FastifyRequest } from 'fastify';

function header(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' && v.length ? v.slice(0, 256) : null;
}

export function platformOf(req: FastifyRequest): Platform {
  const p = header(req, 'x-platform')?.toUpperCase();
  return p && (PLATFORMS as readonly string[]).includes(p) ? (p as Platform) : 'WEB';
}

/** Client metadata used for sessions, devices, audit and security notifications. */
export function requestContext(req: FastifyRequest): RequestContext {
  return {
    ip: req.ip ?? null,
    userAgent: header(req, 'user-agent'),
    deviceId: header(req, 'x-device-id'),
    deviceName: header(req, 'x-device-name'),
    platform: platformOf(req),
  };
}

export function orderSource(req: FastifyRequest): OrderSource {
  if (req.auth?.via === 'apikey') return 'API';
  const p = platformOf(req);
  if (p === 'IOS' || p === 'ANDROID') return 'MOBILE';
  if (p === 'DESKTOP') return 'DESKTOP';
  return 'WEB';
}
