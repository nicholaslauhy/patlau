import assert from 'node:assert/strict';
import test from 'node:test';
import * as SentryNamespace from '@sentry/nextjs';
import { createAuditTrackingTransport } from '../app/lib/sentry-audit-transport.ts';
import { sendSentryLogBatch } from '../app/lib/sentry-log-sink.ts';
import { scrubSentryLog } from '../app/lib/sentry-scrub.ts';

const Sentry = SentryNamespace.default || SentryNamespace;

function capturedLogs(envelopes) {
    return envelopes.flatMap((envelope) => (
        (envelope[1] || [])
            .filter((item) => item?.[0]?.type === 'log')
            .flatMap((item) => item?.[1]?.items || [])
    ));
}

test('the audit sink emits tracked rows through the official Sentry SDK envelope', async () => {
    const envelopes = [];
    let nextStatusCode = 200;

    Sentry.init({
        dsn: 'https://0123456789abcdef0123456789abcdef@example.invalid/12345',
        enableLogs: true,
        tracesSampleRate: 0,
        beforeSendLog: scrubSentryLog,
        transport: () => createAuditTrackingTransport({
            send: async (envelope) => {
                envelopes.push(envelope);
                return { statusCode: nextStatusCode, headers: {} };
            },
            flush: async () => true,
        }),
    });

    const deliveryBatchId = await sendSentryLogBatch([{
        level: 'info',
        body: 'PatLau tracked audit SDK test',
        attributes: {
            source: 'supabase_audit',
            audit_log_id: 123456,
            audit_stable_id: 'supabase-audit-log:123456',
            audit_export_run_id: 'local-sdk-contract-test',
        },
    }]);

    const logs = capturedLogs(envelopes);
    assert.equal(logs.length, 1);
    assert.equal(envelopes[0][0]?.sdk?.name, 'sentry.javascript.nextjs');
    assert.equal(logs[0].body, 'PatLau tracked audit SDK test');
    assert.match(logs[0].trace_id, /^[0-9a-f]{32}$/);
    assert.equal(logs[0].attributes.source.value, 'supabase_audit');
    assert.equal(logs[0].attributes.audit_log_id.value, 123456);
    assert.equal(logs[0].attributes.audit_stable_id.value, 'supabase-audit-log:123456');
    assert.equal(logs[0].attributes.audit_export_run_id.value, 'local-sdk-contract-test');
    assert.equal(logs[0].attributes.audit_delivery_batch_id.value, deliveryBatchId);

    const envelopeCountBeforeLargeBatch = envelopes.length;
    const largeBatchId = await sendSentryLogBatch(Array.from({ length: 205 }, (_, index) => ({
        level: 'info',
        body: `Tracked audit row ${index + 1}`,
        attributes: {
            source: 'supabase_audit',
            audit_log_id: 1_000 + index,
        },
    })));
    const largeBatchLogs = capturedLogs(envelopes)
        .filter((log) => log.attributes.audit_delivery_batch_id.value === largeBatchId);
    assert.equal(largeBatchLogs.length, 205);
    assert.ok(
        envelopes.length - envelopeCountBeforeLargeBatch >= 3,
        'expected the SDK to split a batch larger than its 100-log buffer',
    );

    nextStatusCode = 500;
    await assert.rejects(
        sendSentryLogBatch([{
            level: 'warn',
            body: 'PatLau rejected audit SDK test',
            attributes: {
                source: 'supabase_audit',
                audit_log_id: 102,
            },
        }]),
        /HTTP 500/,
    );

    await Sentry.close(5_000);
});
