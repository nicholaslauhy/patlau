const CHAT_CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETURN_BASE = "https://patlau.invalid";

export function chatReturnPath(conversationId: string | null | undefined) {
    const normalizedId = String(conversationId || "").trim();
    if (!CHAT_CONVERSATION_ID.test(normalizedId)) return null;
    return `/chats?conversation=${normalizedId.toLowerCase()}`;
}

/**
 * Only an exact PatLau chat route is accepted. This intentionally rejects
 * external URLs, protocol-relative URLs, fragments, duplicate parameters and
 * unrelated internal paths so the login page cannot become an open redirect.
 */
export function safeChatReturnPath(value: string | null | undefined) {
    const candidate = String(value || "").trim();
    if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;

    try {
        const url = new URL(candidate, RETURN_BASE);
        if (url.origin !== RETURN_BASE || url.pathname !== "/chats" || url.hash) return null;
        const entries = [...url.searchParams.entries()];
        if (entries.length !== 1 || entries[0][0] !== "conversation") return null;
        return chatReturnPath(entries[0][1]);
    } catch {
        return null;
    }
}
