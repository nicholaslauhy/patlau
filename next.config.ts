import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {};
const sourceMapUploadConfigured = Boolean(
    process.env.SENTRY_AUTH_TOKEN
    && process.env.SENTRY_ORG
    && process.env.SENTRY_PROJECT,
);

export default withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: true,
    sourcemaps: {
        disable: !sourceMapUploadConfigured,
    },
    widenClientFileUpload: sourceMapUploadConfigured,
    webpack: {
        treeshake: {
            removeDebugLogging: true,
        },
    },
});
