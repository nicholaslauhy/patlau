import assert from "node:assert/strict";
import test from "node:test";
import {
    MAX_QUICK_WORKFLOWS,
    defaultQuickWorkflowHrefsForRole,
    dropQuickWorkflow,
    normalizeQuickWorkflowHrefs,
    operationsLinksForRole,
} from "../app/lib/operations-access.ts";

const hrefsFor = (role) => operationsLinksForRole(role).map((item) => item.href);

test("member operations links preserve the existing attendance-only navigation", () => {
    assert.deepEqual(hrefsFor("member"), [
        "/dashboard",
        "/app/weekend/session-reports",
    ]);
});

test("admin operations links preserve fixed-price, coach, and 1-1 access", () => {
    const hrefs = hrefsFor("admin");

    assert.deepEqual(hrefs, [
        "/dashboard",
        "/app/weekend/session-reports",
        "/add",
        "/coachattendance",
        "/training/add",
        "/training",
        "/app/training/session-reports",
    ]);
    assert.equal(hrefs.includes("/payment"), false);
    assert.equal(hrefs.includes("/chats"), false);
    assert.equal(hrefs.includes("/audit-logs"), false);
});

test("superuser operations links include every configured workflow", () => {
    const hrefs = hrefsFor("superuser");

    assert.equal(hrefs.includes("/dashboard"), true);
    assert.equal(hrefs.includes("/payment"), true);
    assert.equal(hrefs.includes("/chats"), true);
    assert.equal(hrefs.includes("/audit-logs"), true);
    assert.equal(hrefs.includes("/weekday/attendance"), true);
    assert.equal(hrefs.includes("/weekday/add"), true);
    assert.equal(hrefs.includes("/weekday/payment"), true);
    assert.equal(hrefs.includes("/matchplay/attendance"), true);
    assert.equal(hrefs.includes("/matchplay/add"), true);
    assert.equal(hrefs.includes("/matchplay/payment"), true);
    assert.equal(hrefs.includes("/trngpayment"), true);
    assert.equal(hrefs.includes("/makeup/payment"), true);
});

test("superuser quick-workflow defaults surface every major programme", () => {
    assert.deepEqual(defaultQuickWorkflowHrefsForRole("superuser"), [
        "/dashboard",
        "/weekday/attendance",
        "/matchplay/attendance",
        "/training",
        "/chats",
    ]);
});

test("saved quick workflows are role-filtered, deduplicated, and limited to five", () => {
    assert.deepEqual(
        normalizeQuickWorkflowHrefs("admin", [
            "/dashboard",
            "/payment",
            "/dashboard",
            "/add",
            "/coachattendance",
            "/training",
            "/training/add",
            "/app/training/session-reports",
        ]),
        [
            "/dashboard",
            "/add",
            "/coachattendance",
            "/training",
            "/training/add",
        ],
    );
    assert.equal(
        normalizeQuickWorkflowHrefs("superuser", hrefsFor("superuser")).length,
        MAX_QUICK_WORKFLOWS,
    );
});

test("dragging reorders selected workflows and replaces a target when full", () => {
    const selectedHrefs = defaultQuickWorkflowHrefsForRole("superuser");

    assert.deepEqual(
        dropQuickWorkflow({
            role: "superuser",
            selectedHrefs,
            draggedHref: "/chats",
            targetHref: "/weekday/attendance",
        }),
        [
            "/dashboard",
            "/chats",
            "/weekday/attendance",
            "/matchplay/attendance",
            "/training",
        ],
    );

    assert.deepEqual(
        dropQuickWorkflow({
            role: "superuser",
            selectedHrefs,
            draggedHref: "/payment",
            targetHref: "/training",
        }),
        [
            "/dashboard",
            "/weekday/attendance",
            "/matchplay/attendance",
            "/payment",
            "/chats",
        ],
    );
});
