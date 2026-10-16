import type { Key, Params } from '../../shared/i18n/index.ts';

/** An API error: carries a dictionary key, translated into the request user's language in `onError`. */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502 | 503,
    readonly key: Key,
    readonly params?: Params,
  ) {
    super(key);
  }
}

export const fail = (status: ApiError['status'], key: Key, params?: Params) => new ApiError(status, key, params);
