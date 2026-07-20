# HTTP Session Cookie Override Design

## Goal

Allow an administrator to use the application through an HTTP IP address during staged deployment, without weakening the default HTTPS production behavior.

## Decision

Session cookie security is resolved from a new `SESSION_COOKIE_SECURE` environment variable. When it is set to `true` or `false`, that explicit value wins. When it is absent, the existing production default remains: secure cookies are enabled only when `NODE_ENV=production`.

## Operational behavior

The production environment example documents `SESSION_COOKIE_SECURE=false` only for temporary HTTP/IP access. Operators must set it back to `true` before publishing a HTTPS endpoint. Existing deployments without the variable keep their current behavior.

## Verification

Unit tests cover explicit false, explicit true, and the unchanged environment-derived fallback. Type checks and focused tests verify the implementation before deployment.
