import assert from 'node:assert/strict';
import test from 'node:test';
import * as SentryNamespace from '@sentry/nextjs';
import { createAuditTrackingTransport } from '../app/lib/sentry-audit-transport.ts';
import { sendSentryLogBatch } from '../app/lib/sentry-log-sink.ts';
import { scrubSentryLog, scrubSentryText } from '../app/lib/sentry-scrub.ts';

const Sentry = SentryNamespace.default || SentryNamespace;

function capturedLogs(envelopes) {
    return envelopes.flatMap((envelope) => (
        (envelope[1] || [])
            .filter((item) => item?.[0]?.type === 'log')
            .flatMap((item) => item?.[1]?.items || [])
    ));
}

test('the Sentry scrubber removes Telegram bot credentials and private file paths from URLs', () => {
    const botToken = '123456789:AAExampleSecretToken_0123456789';
    const filePath = 'photos/file_42.jpg';
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    const apiUrl = `https://api.telegram.org/bot${botToken}/getFile`;
    const internalRef = 'patlau-internal:telegram-photo:v1:QWdBQ0FnVUFBeGtCQUFJQjQy';

    const scrubbedText = scrubSentryText(
        `Telegram download failed at ${fileUrl}; API request: ${apiUrl}; ref: ${internalRef}`,
    );
    assert.equal(scrubbedText.includes(botToken), false);
    assert.equal(scrubbedText.includes(filePath), false);
    assert.equal(scrubbedText.includes(internalRef), false);
    assert.match(
        scrubbedText,
        /https:\/\/api\.telegram\.org\/file\/bot\[FILTERED\]\/\[FILTERED_FILE\]/,
    );
    assert.match(
        scrubbedText,
        /https:\/\/api\.telegram\.org\/bot\[FILTERED\]\/getFile/,
    );

    const scrubbedLog = scrubSentryLog({
        message: `Could not download ${fileUrl}`,
        body: `Telegram returned an error for ${apiUrl}`,
        attributes: {
            error: {
                request_url: fileUrl,
                retry_url: apiUrl,
                source_ref: internalRef,
            },
        },
    });
    const serialized = JSON.stringify(scrubbedLog);
    assert.equal(serialized.includes(botToken), false);
    assert.equal(serialized.includes(filePath), false);
    assert.equal(serialized.includes(internalRef), false);
    assert.equal(
        scrubSentryText('https://telegram.org/privacy'),
        'https://telegram.org/privacy',
    );
});

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
