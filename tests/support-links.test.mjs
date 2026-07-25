import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
    buildSupportAppSchemeUrl,
    buildSupportConversationLinks,
    formatSupportConversationLinks,
    normalizeSupportConversationId,
} from "../app/lib/support-links.ts";
import { GET as getAppLinkFallback } from "../app/open-in-app/chats/route.ts";

const conversationId = "7cda7535-f22d-405e-a996-12f9c30db44d";

test("support notifications provide distinct app and website conversation links", () => {
    assert.deepEqual(
        buildSupportConversationLinks(conversationId, "https://patlaubmt.vercel.app/"),
        {
            appUrl: `https://patlaubmt.vercel.app/open-in-app/chats?conversation=${conversationId}`,
            webUrl: `https://patlaubmt.vercel.app/chats?conversation=${conversationId}`,
        },
    );
    assert.equal(
        formatSupportConversationLinks(conversationId, "https://patlaubmt.vercel.app"),
        `\n\nOpen in PatLau app: https://patlaubmt.vercel.app/open-in-app/chats?conversation=${conversationId}`
        + `\nOpen on website: https://patlaubmt.vercel.app/chats?conversation=${conversationId}`,
    );
});

test("support conversation links fail closed for malformed IDs and site URLs", () => {
    assert.deepEqual(
        buildSupportConversationLinks("../../settings", "https://patlaubmt.vercel.app"),
        { appUrl: null, webUrl: null },
    );
    assert.deepEqual(
        buildSupportConversationLinks(conversationId, "javascript:alert(1)"),
        { appUrl: null, webUrl: null },
    );
    assert.deepEqual(
        buildSupportConversationLinks(conversationId, "not a URL"),
        { appUrl: null, webUrl: null },
    );
});

test("the app custom scheme accepts only valid conversation UUIDs", () => {
    assert.equal(normalizeSupportConversationId(` ${conversationId} `), conversationId);
    assert.equal(normalizeSupportConversationId("../../settings"), null);
    assert.equal(
        buildSupportAppSchemeUrl(conversationId),
        `patlau://chats?conversation=${conversationId}`,
    );
    assert.equal(buildSupportAppSchemeUrl("javascript:alert(1)"), null);
});

test("the app bridge preserves a valid conversation and provides both destinations", async () => {
    const valid = await getAppLinkFallback(new NextRequest(
        `https://patlaubmt.vercel.app/open-in-app/chats?conversation=${conversationId}`,
    ));
    const html = await valid.text();
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(valid.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
    assert.match(valid.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
    assert.match(html, new RegExp(`patlau://chats\\?conversation=${conversationId}`));
    assert.match(
        html,
        new RegExp(`https://patlaubmt\\.vercel\\.app/chats\\?conversation=${conversationId}`),
    );
    assert.match(html, /Open PatLau app/);
    assert.match(html, /Continue on website/);
    assert.match(html, /window\.location\.replace/);
});

test("the app bridge rejects malformed conversation IDs without opening the app", async () => {
    const invalid = await getAppLinkFallback(new NextRequest(
        "https://patlaubmt.vercel.app/open-in-app/chats?conversation=../../settings",
    ));
    const html = await invalid.text();
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("cache-control"), "no-store, max-age=0");
    assert.doesNotMatch(html, /patlau:\/\/chats/);
    assert.match(html, /https:\/\/patlaubmt\.vercel\.app\/chats/);
    assert.match(html, /This conversation link is invalid/);
});
