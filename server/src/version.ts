// __APP_VERSION__ / __GIT_SHA__ are substituted by esbuild (server/build.mjs); under tsx (dev, tests) they are not defined.
declare const __APP_VERSION__: string | undefined;
declare const __GIT_SHA__: string | undefined;

export const version = (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) || process.env.APP_VERSION || 'dev';
export const sha = (typeof __GIT_SHA__ !== 'undefined' && __GIT_SHA__) || process.env.GIT_SHA || 'unknown';
