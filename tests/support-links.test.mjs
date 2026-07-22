import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
    buildAppleAppSiteAssociation,
    buildSupportConversationLinks,
    formatSupportConversationLinks,
} from "../app/lib/support-links.ts";
import { GET as getAppleAssociation } from "../app/.well-known/apple-app-site-association/route.ts";
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

test("the Apple association scopes Universal Links to app conversation URLs", () => {
    assert.deepEqual(
        buildAppleAppSiteAssociation("ABCDE12345", "com.patlau.coaching"),
        {
            applinks: {
                details: [
                    {
                        appIDs: ["ABCDE12345.com.patlau.coaching"],
                        components: [
                            {
                                "/": "/open-in-app/chats",
                                "?": { conversation: "*" },
                                comment: "Opens a PatLau parent-support conversation in the iOS app.",
                            },
                        ],
                    },
                ],
            },
        },
    );
    assert.equal(buildAppleAppSiteAssociation("too-short", "com.patlau.coaching"), null);
    assert.equal(buildAppleAppSiteAssociation("ABCDE12345", "com..patlau"), null);
});

test("the app-link web fallback preserves valid conversations and drops malformed ones", async () => {
    const valid = await getAppLinkFallback(new NextRequest(
        `https://patlaubmt.vercel.app/open-in-app/chats?conversation=${conversationId}`,
    ));
    assert.equal(valid.status, 307);
    assert.equal(
        valid.headers.get("location"),
        `https://patlaubmt.vercel.app/chats?conversation=${conversationId}`,
    );

    const invalid = await getAppLinkFallback(new NextRequest(
        "https://patlaubmt.vercel.app/open-in-app/chats?conversation=../../settings",
    ));
    assert.equal(invalid.headers.get("location"), "https://patlaubmt.vercel.app/chats");
});

test("the Apple association endpoint is explicit when configuration is missing", async () => {
    const previousPrefix = process.env.APPLE_APP_IDENTIFIER_PREFIX;
    const previousBundleId = process.env.APPLE_APP_BUNDLE_ID;
    delete process.env.APPLE_APP_IDENTIFIER_PREFIX;
    delete process.env.APPLE_APP_BUNDLE_ID;
    try {
        const missing = await getAppleAssociation();
        assert.equal(missing.status, 503);
        assert.equal(missing.headers.get("cache-control"), "no-store");

        process.env.APPLE_APP_IDENTIFIER_PREFIX = "ABCDE12345";
        process.env.APPLE_APP_BUNDLE_ID = "com.patlau.coaching";
        const configured = await getAppleAssociation();
        assert.equal(configured.status, 200);
        assert.match(configured.headers.get("content-type") || "", /^application\/json/);
        assert.equal(
            (await configured.json()).applinks.details[0].appIDs[0],
            "ABCDE12345.com.patlau.coaching",
        );
    } finally {
        if (previousPrefix === undefined) delete process.env.APPLE_APP_IDENTIFIER_PREFIX;
        else process.env.APPLE_APP_IDENTIFIER_PREFIX = previousPrefix;
        if (previousBundleId === undefined) delete process.env.APPLE_APP_BUNDLE_ID;
        else process.env.APPLE_APP_BUNDLE_ID = previousBundleId;
    }
});
