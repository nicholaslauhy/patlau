import assert from 'node:assert/strict';
import test from 'node:test';
import {
    auditDisplaySummary,
    auditDisplayTargetLabel,
} from '../app/lib/audit-display.ts';

const baseEntry = {
    action: 'update',
    summary: 'nic updated a record',
    actor_source: 'authenticated',
    actor_name: 'nic',
    actor_email: null,
    target_table: null,
    target_label: null,
};

test('a resolved payment presentation replaces its numeric database key', () => {
    const entry = {
        ...baseEntry,
        action: 'insert',
        target_table: 'payment_history',
        target_label: '57',
        summary: 'nic created payment history "57"',
        display_summary: 'nic recorded a Weekend payment of S$80.00 for Brendan Lau',
        display_target_label: 'Brendan Lau',
    };

    assert.equal(
        auditDisplaySummary(entry),
        'nic recorded a Weekend payment of S$80.00 for Brendan Lau',
    );
    assert.equal(auditDisplayTargetLabel(entry), 'Brendan Lau');
});

test('deployment-overlap fallbacks never expose payment IDs or student UUIDs', () => {
    const payment = {
        ...baseEntry,
        action: 'insert',
        target_table: 'payment_history',
        target_label: '57',
        summary: 'nic created payment history "57"',
    };
    assert.equal(auditDisplaySummary(payment), 'nic recorded a Weekend payment record');
    assert.equal(auditDisplayTargetLabel(payment), null);

    const attendance = {
        ...baseEntry,
        action: 'makeup',
        target_table: 'student_audit',
        target_label: '18f40cca-87cf-43a4-a925-6d96147ae8e2',
        summary: 'nic recorded "makeup" for student 18f40cca-87cf-43a4-a925-6d96147ae8e2',
    };
    assert.equal(
        auditDisplaySummary(attendance),
        'nic recorded makeup attendance for a Weekend student',
    );
    assert.equal(auditDisplayTargetLabel(attendance), null);
});

test('normal human labels remain visible and unknown UUIDs are sanitized', () => {
    const named = { ...baseEntry, target_label: 'Brendan Lau' };
    assert.equal(auditDisplayTargetLabel(named), 'Brendan Lau');

    const generic = {
        ...baseEntry,
        summary: 'nic updated support chat 3de79fc3-7fbd-4f58-bf4b-a26f757595b1',
    };
    assert.equal(auditDisplaySummary(generic), 'nic updated support chat record');
});
