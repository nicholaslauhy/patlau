export const AI_MESSAGE_LABEL = "PatLau AI Assistant (AI-generated)";
export const SYSTEM_MESSAGE_LABEL = "PatLau Support Update";
export const COACH_MESSAGE_LABEL = "Coach Patrick (human reply)";
export const AI_INTRO_MESSAGE = "Hello! I can help with general coaching information, schedules, locations, fees and current announcements. Simply type and send your question below—there is no need to select an option first. If your question needs personal assistance, I’ll connect you directly with Coach Patrick.";
export const CLOSED_CONVERSATION_MESSAGE = "This conversation is closed. Select Reopen conversation below or simply send a new message whenever you need more help.";
export const COACH_CLOSED_CONVERSATION_MESSAGE = "Coach Patrick has closed this conversation. Select Reopen conversation below or simply send a new message whenever you need more help.";
export const REOPENED_CONVERSATION_MESSAGE = "Conversation reopened. Please type and send your question below.";

export function reopenConversationKeyboard(conversationId: string) {
    return {
        inline_keyboard: [
            [{ text: "Reopen conversation", callback_data: `ps|reopen|${conversationId}` }],
        ],
    };
}

export function normaliseCoachReferences(content: string) {
    return content
        .replace(/Coach\s+Nicholas/gi, "Coach Patrick")
        .replace(/\bcoach\s+patrick\b/gi, "Coach Patrick")
        .replace(
            /\b((?:connect|refer|pass|transfer)(?:s|ed|ing)?\b[^.!?\n]{0,50}\b(?:to|with)\s+)(?:a|the|our|your)\s+(?:human\s+)?coach\b/gi,
            "$1Coach Patrick",
        )
        .replace(
            /\b((?:talk|speak|chat)(?:s|ed|ing)?\b[^.!?\n]{0,24}\b(?:to|with)\s+)(?:a|the|our|your)\s+(?:human\s+)?coach\b/gi,
            "$1Coach Patrick",
        )
        .replace(
            /\b(?:a|the|our|your)\s+coach\b(?=\s+(?:will|can|may|should|would|could|is\s+going\s+to)\s+(?:reply|respond|contact|review|help|assist|take\s+over)\b)/gi,
            "Coach Patrick",
        )
        .replace(
            /\bcoach\b(?=\s+(?:will|can|may|should|would|could|is\s+going\s+to)\s+(?:reply|respond|contact|review|help|assist|take\s+over)\b)/gi,
            "Coach Patrick",
        )
        .replace(
            /\b(?:a|the)\s+human(?:\s+(?:agent|representative))?\b(?=\s+(?:will|can|may|should|would|could)\s+(?:reply|respond|contact|review|help|assist|take\s+over)\b)/gi,
            "Coach Patrick",
        );
}

export function formatAiReply(content: string) {
    return `${AI_MESSAGE_LABEL}\n\n${normaliseCoachReferences(content).trim()}`;
}

export function formatSystemMessage(content: string) {
    return `${SYSTEM_MESSAGE_LABEL}\n\n${normaliseCoachReferences(content).trim()}`;
}

export function formatCoachReply(content: string) {
    return `${COACH_MESSAGE_LABEL}\n\n${normaliseCoachReferences(content).trim()}`;
}

export function parentExplicitlyRequestsCoach(text: string) {
    return /^\/human(?:@\w+)?(?:\s|$)/i.test(text)
        || /\b(?:talk|speak|chat|connect|transfer|pass)\s+(?:me\s+)?(?:to|with)\s+(?:a\s+|the\s+)?(?:human|person|coach|patrick)\b/i.test(text)
        || /\b(?:want|need|prefer|request|would\s+like)(?:\s+to)?\s+(?:talk|speak|chat|connect|be\s+transferred)\b[^.!?]{0,40}\b(?:human|person|coach|patrick)\b/i.test(text)
        || /\b(?:want|need|request)\s+(?:a|the)\s+(?:human|person|coach)\s*(?:please|now)?[.!?]*$/i.test(text)
        || /\b(?:want|need|request)\s+(?:a|the)\s+coach\s+(?:to\s+)?(?:reply|respond|call|contact|take\s+over|help\s+me)\b/i.test(text)
        || /^(?:coach\s+patrick|patrick)\s*(?:please|now)?[.!?]*$/i.test(text)
        || /\b(?:want|need|request)\s+coach\s+patrick\s*(?:please|now)?[.!?]*$/i.test(text);
}

export function parentIsDissatisfied(text: string) {
    return /\b(?:i(?:'m|\s+am|\s+feel)|this\s+is\s+making\s+me|you(?:'ve|\s+have)\s+made\s+me)\s+(?:very\s+)?(?:dissatisfied|frustrated|annoyed|upset|angry)\b/i.test(text)
        || /\b(?:i(?:'m|\s+am)\s+not\s+(?:happy|satisfied)|this\s+is\s+not\s+helpful|your\s+(?:answer|reply|response)\s+is\s+(?:unacceptable|ridiculous|useless))\b/i.test(text)
        || /\b(?:you(?:'re|\s+are)?\s+not\s+helping|(?:that|this)\s+(?:does(?:n't|\s+not)|did(?:n't|\s+not))\s+answer|(?:that|this)\s+does(?:n't|\s+not)\s+make\s+sense|wrong\s+answer|not\s+what\s+i\s+asked|stop\s+repeating|i\s+already\s+asked|you\s+keep\s+repeating)\b/i.test(text);
}

export function shouldOfferDelayedFeedback(previousAiReplyCount: number) {
    const replyNumber = previousAiReplyCount + 1;
    return replyNumber >= 3 && replyNumber % 3 === 0;
}
