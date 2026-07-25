const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export function normalizeSupportConversationId(value: unknown) {
    const conversationId = typeof value === "string" ? value.trim() : "";
    return CONVERSATION_ID_PATTERN.test(conversationId) ? conversationId : null;
}

export function buildSupportAppSchemeUrl(conversationIdValue: unknown) {
    const conversationId = normalizeSupportConversationId(conversationIdValue);
    if (!conversationId) return null;

    const appUrl = new URL("patlau://chats");
    appUrl.searchParams.set("conversation", conversationId);
    return appUrl.toString();
}

export function buildSupportConversationLinks(
    conversationIdValue: unknown,
    siteUrlValue: unknown,
) {
    const conversationId = normalizeSupportConversationId(conversationIdValue);
    const baseUrl = productionBaseUrl(siteUrlValue);
    if (!baseUrl || !conversationId) {
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
