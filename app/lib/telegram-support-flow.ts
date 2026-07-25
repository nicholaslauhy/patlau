export const AI_MESSAGE_DISCLAIMER = "This is an automated AI-generated message based on the information provided.";
export const AI_INTRO_MESSAGE = "Hello! I can help with general coaching information, schedules, locations, fees and current announcements. Simply type and send your question below—there is no need to select an option first. You may also send a photo; it is automatically checked only to route the query, and possible injury, safety or complaint photos go directly to Coach Patrick. If your question needs personal assistance, I’ll connect you directly with Coach Patrick.";
export const CLOSED_CONVERSATION_MESSAGE = "This conversation is closed. Select Reopen conversation below or simply send a new message whenever you need more help.";
export const COACH_CLOSED_CONVERSATION_MESSAGE = "Coach Patrick has closed this conversation. Select Reopen conversation below or simply send a new message whenever you need more help.";
export const REOPENED_CONVERSATION_MESSAGE = "Conversation reopened. Please type and send your question below.";
export const DELETE_CONVERSATION_CONFIRMATION_MESSAGE = "Permanently delete this conversation from PatLau's stored records? This removes its chat history from the website and cannot be undone. It does not delete messages already visible in Telegram.";
export const DELETE_CONVERSATION_CANCELLED_MESSAGE = "Deletion cancelled. Your stored conversation is still available.";
export const DELETED_CONVERSATION_MESSAGE = "Your stored PatLau conversation has been permanently deleted. Send a new message whenever you want to start a fresh conversation.";

export function reopenConversationKeyboard(conversationId: string) {
    return {
        inline_keyboard: [
            [{ text: "Reopen conversation", callback_data: `ps|reopen|${conversationId}` }],
            [{ text: "Delete stored conversation", callback_data: `ps|delete_request|${conversationId}` }],
        ],
    };
}

export function supportHelpKeyboard(conversationId: string) {
    return {
        inline_keyboard: [
            [{ text: "Delete stored conversation", callback_data: `ps|delete_request|${conversationId}` }],
        ],
    };
}

export function deleteConversationConfirmationKeyboard(conversationId: string) {
    return {
        inline_keyboard: [[
            { text: "Yes, delete permanently", callback_data: `ps|delete_confirm|${conversationId}` },
            { text: "Cancel", callback_data: `ps|delete_cancel|${conversationId}` },
        ]],
    };
}

export function isAuthorizedParentDeleteCallback(input: {
    action: string;
    callbackUserId: string;
    callbackChatId: string;
    callbackChatType: string;
    contactUserId: string;
    contactChatId: string;
}) {
    return ["delete_request", "delete_confirm", "delete_cancel"].includes(input.action)
        && Boolean(input.callbackUserId)
        && input.callbackUserId === input.contactUserId
        && Boolean(input.callbackChatId)
        && input.callbackChatId === input.contactChatId
        && input.callbackChatType === "private";
}

export function coachHandoffKeyboard(conversationId: string) {
    return {
        inline_keyboard: [[
            { text: "Yes, connect me", callback_data: `ps|handoff_yes|${conversationId}` },
            { text: "No, continue with AI", callback_data: `ps|handoff_no|${conversationId}` },
        ]],
    };
}

export function coachReplyCloseKeyboard(conversationId: string) {
    return {
        inline_keyboard: [
            [{ text: "Close conversation", callback_data: `ps|close|${conversationId}` }],
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

function formatWithDisclaimer(content: string, disclaimer: string) {
    const footer = `\n\n${disclaimer}`;
    const maximumContentLength = 3900 - footer.length;
    const message = normaliseCoachReferences(content).trim().slice(0, maximumContentLength).trimEnd();
    return `${message}${footer}`;
}

export function formatAiReply(content: string) {
    return formatWithDisclaimer(content, AI_MESSAGE_DISCLAIMER);
}

export function formatSystemMessage(content: string) {
    return normaliseCoachReferences(content).trim().slice(0, 3900).trimEnd();
}

export function formatCoachReply(content: string) {
    return content.trim().slice(0, 3900).trimEnd();
}

export function parentConversationStatusMessage(status: string) {
    switch (status) {
        case "escalated":
            return "Escalated to Coach Patrick. He has been notified and will reply in this chat.";
        case "human_active":
            return "Escalated to Coach Patrick. Coach Patrick is handling this conversation and the AI assistant is paused.";
        case "resolved":
            return "This conversation is closed. You can reopen it whenever you need more help.";
        case "closed_parent":
            return "You closed this conversation. You can reopen it whenever you need more help.";
        case "waiting_parent":
            return "The AI assistant has replied and is waiting for your next message.";
        default:
            return "The AI assistant is helping with this conversation.";
    }
}

export function parentExplicitlyRequestsCoach(text: string) {
    return /\b(?:talk|speak|chat|connect|transfer|pass)\s+(?:me\s+)?(?:to|with)\s+(?:a\s+|the\s+)?(?:human|person|coach|patrick)\b/i.test(text)
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

export function parentRaisesComplaint(text: string) {
    return /\b(?:complaint|complain(?:ed|ing|s)?|refund|dispute|unacceptable|misconduct)\b/i.test(text)
        || parentIsDissatisfied(text);
}

export function parentRaisesInjuryOrSafetyConcern(text: string) {
    return /\b(?:injur(?:y|ies|ed)|hurt|bleed(?:ing)?|faint(?:ed|ing)?|unconscious|collaps(?:e|ed|ing)|accident|sprain(?:ed)?|fractur(?:e|ed)|concussion|seizure|allergic\s+reaction|can(?:not|'t)\s+breathe|chest\s+pain|hospital|ambulance|medical\s+emergency|unsafe|safety\s+(?:concern|issue|risk)|abuse|abused|harass(?:ed|ment)|assault(?:ed)?|immediate\s+danger)\b/i.test(text);
}

export function shouldDeliverSupportAiResponse(
    status: string,
    inboundMessageId: string | number,
    latestInboundMessageId: string | number | null | undefined,
) {
    return ["ai_active", "waiting_parent"].includes(status)
        && String(inboundMessageId) === String(latestInboundMessageId || "");
}

export function shouldOfferDelayedFeedback(previousAiReplyCount: number) {
    const replyNumber = previousAiReplyCount + 1;
    return replyNumber >= 3 && replyNumber % 3 === 0;
}
