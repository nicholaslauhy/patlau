import assert from 'node:assert/strict';
import test from 'node:test';
import * as SentryNamespace from '@sentry/nextjs';

const Sentry = SentryNamespace.default || SentryNamespace;

test('the installed Sentry SDK emits structured log envelopes', async () => {
    const envelopes = [];

    Sentry.init({
        dsn: 'https://0123456789abcdef0123456789abcdef@example.invalid/12345',
        enableLogs: true,
        tracesSampleRate: 0,
        transport: () => ({
            send: async (envelope) => {
                envelopes.push(envelope);
                return { statusCode: 200, headers: {} };
            },
            flush: async () => true,
        }),
    });

    Sentry.logger.info('PatLau Sentry Logs SDK test', {
        source: 'patlau_sentry_probe',
        probe_id: 'local-sdk-contract-test',
    });

    assert.equal(await Sentry.flush(5_000), true);

    const logItems = envelopes.flatMap((envelope) => (
        (envelope[1] || []).filter((item) => item?.[0]?.type === 'log')
    ));
    assert.ok(logItems.length > 0, 'expected the SDK transport to receive a log item');
    assert.match(JSON.stringify(logItems), /local-sdk-contract-test/);

    await Sentry.close(5_000);
});
