import { REOPENED_CONVERSATION_MESSAGE } from "./telegram-support-flow";

export type SupportConversationMessage = {
    sender_type: string;
    content: string | null | undefined;
    telegram_delivery_status?: string | null;
    created_at?: string | null;
    id?: string | number | null;
};

export const COACH_FOLLOW_UP_REOPENED_MESSAGE = "Coach Patrick reopened this conversation to send a follow-up.";

const REOPEN_MARKERS = new Set([
    REOPENED_CONVERSATION_MESSAGE,
    COACH_FOLLOW_UP_REOPENED_MESSAGE,
]);

const ACKNOWLEDGEMENT_WORDS = new Set([
    "hi",
    "hello",
    "hey",
    "ok",
    "okay",
    "noted",
    "thanks",
    "thank",
    "you",
    "sure",
    "alright",
    "understood",
    "got",
    "it",
]);

const NON_SUBSTANTIVE_PHRASES = new Set([
    "how can i help",
    "how may i help",
    "what can i do",
    "what can i help with",
    "hi there",
    "good morning",
    "good afternoon",
    "good evening",
    "你好",
    "您好",
    "嗨",
    "好的",
    "收到",
    "谢谢",
    "謝謝",
    "明白",
    "了解",
    "早上好",
    "下午好",
    "晚上好",
    "hai",
    "helo",
    "baik",
    "terima kasih",
    "faham",
    "selamat pagi",
    "selamat petang",
    "こんにちは",
    "ありがとう",
    "わかりました",
    "வணக்கம்",
    "நன்றி",
    "சரி",
    "புரிந்தது",
]);

function normaliseText(text: string | null | undefined) {
    return (text || "")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * A short greeting or acknowledgement should not prompt a parent to close an
 * ongoing conversation. A response becomes substantive once Coach Patrick
 * provides information beyond a greeting, acknowledgement, or offer to help.
 */
export function isSubstantiveCoachReply(text: string | null | undefined) {
    const normalised = normaliseText(text);
    if (!normalised) return false;

    const withoutGreeting = normalised
        .replace(/^(?:(?:hi|hello|hey)(?:\s+there)?|good\s+(?:morning|afternoon|evening))\s*/, "")
        .trim();
    if (!withoutGreeting || NON_SUBSTANTIVE_PHRASES.has(withoutGreeting)) return false;
    const isInformationRequest = /^(?:(?:can|could|would|will)\s+you|please|kindly)\s+(?:send|share|tell|provide|confirm|clarify|explain|describe|forward|upload|let\s+me\s+know)\b/i.test(withoutGreeting);
    const isSingleQuestion = /^(?:what|when|where|which|who|why|how|is|are|do|does|did|can|could|would)\b[^.!]*\?$/i.test(withoutGreeting);
    if (isInformationRequest || isSingleQuestion) return false;

    const meaningfulWords = withoutGreeting
        .split(" ")
        .filter(Boolean)
        .filter((word) => !ACKNOWLEDGEMENT_WORDS.has(word));
    if (/[^\x00-\x7F]/.test(withoutGreeting)) {
        return [...withoutGreeting.replace(/\s/g, "")].length >= 6;
    }
    return withoutGreeting.length >= 15 && meaningfulWords.length >= 3;
}

function hasUsableCreatedAt(message: SupportConversationMessage) {
    return Boolean(message.created_at && !Number.isNaN(Date.parse(message.created_at)));
}

/**
 * Returns messages in chronological order when every message has a valid
 * `created_at`. For legacy/test data without timestamps, the supplied array
 * order is treated as chronological order.
 */
function chronologicalMessages(messages: SupportConversationMessage[]) {
    const indexed = messages.map((message, index) => ({ message, index }));
    if (!indexed.every(({ message }) => hasUsableCreatedAt(message))) {
        return indexed.map(({ message }) => message);
    }

    return indexed
        .sort((left, right) => {
            const timestampDifference = Date.parse(left.message.created_at!) - Date.parse(right.message.created_at!);
            return timestampDifference || left.index - right.index;
        })
        .map(({ message }) => message);
}

function isConversationReopenMarker(message: SupportConversationMessage) {
    return message.sender_type === "system" && REOPEN_MARKERS.has(message.content || "");
}

/**
 * A parent may be offered the close action only after their latest message has
 * received a substantive superuser reply. Any later parent message or system
 * reopen marker requires a fresh, substantive Coach Patrick response before
 * closing is offered again.
 */
export function canCloseAfterCoachReply(messages: SupportConversationMessage[]) {
    const ordered = chronologicalMessages(messages);
    let closeBaselineIndex = -1;

    ordered.forEach((message, index) => {
        if (
            message.sender_type === "parent"
            || isConversationReopenMarker(message)
        ) {
            closeBaselineIndex = index;
        }
    });

    if (closeBaselineIndex === -1) return false;

    return ordered.slice(closeBaselineIndex + 1).some((message) => (
        message.sender_type === "superuser"
        && message.telegram_delivery_status !== "sent_unverified_context"
        && isSubstantiveCoachReply(message.content)
    ));
}
