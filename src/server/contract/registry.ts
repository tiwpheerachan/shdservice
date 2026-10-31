import { OpenAPIRegistry, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';

/**
 * Every operation of /api, declared once: the OpenAPI document, /api-docs and the response check are built from it,
 * and routes parse their input ONLY with these schemas (scripts/test-routes-input.mts), so a documented field is one
 * the route reads. Declarations live in <family>.ts — a route.ts may export only its verbs and segment config.
 *
 * No 'server-only' import: scripts/build-api-docs.ts and the tests load this with plain tsx. Nothing a client
 * component imports may import it.
 */

export const registry = new OpenAPIRegistry();

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type Part = 'params' | 'query' | 'headers' | 'body' | 'form';

/**
 * How a part that fails its schema is refused. 'fields' (the default): 400 "กรอกข้อมูลไม่ครบ N ช่อง" +
 * `details.fields` — assertValid, the form rules. A status: that status with the first problem's own
 * message as `error` — a route's own words ("id required", "unknown export: x").
 */
export type Invalid = Partial<Record<Part, 'fields' | 400 | 404>>;

export interface Operation {
  method: Method;
  /** OpenAPI-shaped, under /api: `/jobs/{no}`. */
  path: string;
  tags: string[];
  summary: string;
  description?: string;
  /** `[]` for a public endpoint; omitted = the session cookie. */
  security?: RouteConfig['security'];
  params?: z.ZodObject;
  query?: z.ZodObject;
  /** request headers the operation reads (Idempotency-Key, x-track-session) */
  headers?: z.ZodObject;
  body?: z.ZodType;
  /** a multipart/form-data body (parseForm) */
  form?: z.ZodObject;
  invalid?: Invalid;
  responses: RouteConfig['responses'];
}

/** Registers the operation for the document and hands it back, schemas and all, for its route to parse with. */
export function defineOperation<O extends Operation>(operation: O): O {
  registry.registerPath({
    method: operation.method,
    path: operation.path,
    tags: operation.tags,
    summary: operation.summary,
    description: operation.description,
    security: operation.security,
    request: {
      params: operation.params,
      query: operation.query,
      headers: operation.headers,
      body: operation.form
        ? { required: true, content: { 'multipart/form-data': { schema: operation.form } } }
        : operation.body
          ? { required: true, content: { 'application/json': { schema: operation.body } } }
          : undefined,
    },
    responses: operation.responses,
  });
  return operation;
}
