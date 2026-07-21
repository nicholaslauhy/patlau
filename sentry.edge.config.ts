import * as Sentry from '@sentry/nextjs';
import { scrubSentryLog } from './app/lib/sentry-scrub';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
    Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
        enableLogs: true,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSendLog: scrubSentryLog,
    });
}
