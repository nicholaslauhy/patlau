const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_IDENTIFIER_PREFIX_PATTERN = /^[A-Z0-9]{10}$/;
const BUNDLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{2,199}$/;

function productionBaseUrl(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
        const url = new URL(value.trim());
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        url.pathname = "/";
        url.search = "";
        url.hash = "";
        return url;
    } catch {
        return null;
    }
}

export function buildSupportConversationLinks(
    conversationIdValue: unknown,
    siteUrlValue: unknown,
) {
    const conversationId = typeof conversationIdValue === "string"
        ? conversationIdValue.trim()
        : "";
    const baseUrl = productionBaseUrl(siteUrlValue);
    if (!baseUrl || !CONVERSATION_ID_PATTERN.test(conversationId)) {
        return { appUrl: null, webUrl: null };
    }

    const appUrl = new URL("/open-in-app/chats", baseUrl);
    appUrl.searchParams.set("conversation", conversationId);
    const webUrl = new URL("/chats", baseUrl);
    webUrl.searchParams.set("conversation", conversationId);

    return {
        appUrl: appUrl.toString(),
        webUrl: webUrl.toString(),
    };
}

export function formatSupportConversationLinks(
    conversationIdValue: unknown,
    siteUrlValue: unknown,
) {
    const { appUrl, webUrl } = buildSupportConversationLinks(
        conversationIdValue,
        siteUrlValue,
    );
    if (!appUrl || !webUrl) return "";
    return `\n\nOpen in PatLau app: ${appUrl}\nOpen on website: ${webUrl}`;
}

export function buildAppleAppSiteAssociation(
    identifierPrefixValue: unknown,
    bundleIdValue: unknown,
) {
    const identifierPrefix = typeof identifierPrefixValue === "string"
        ? identifierPrefixValue.trim()
        : "";
    const bundleId = typeof bundleIdValue === "string"
        ? bundleIdValue.trim()
        : "";
    if (
        !APP_IDENTIFIER_PREFIX_PATTERN.test(identifierPrefix)
        || !BUNDLE_IDENTIFIER_PATTERN.test(bundleId)
        || bundleId.includes("..")
    ) {
        return null;
    }

    return {
        applinks: {
            details: [
                {
                    appIDs: [`${identifierPrefix}.${bundleId}`],
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
    };
}
