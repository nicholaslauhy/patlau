export type SupportStatus =
    | "ai_active"
    | "waiting_parent"
    | "escalated"
    | "human_active"
    | "resolved"
    | "closed_parent";

export type SupportTelegramReceiptStatus =
    | "sending"
    | "sent"
    | "parent_replied"
    | "failed";

export interface SupportContact {
    id: string;
    telegram_chat_id: string;
    telegram_user_id: string | null;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    language_code: string | null;
    blocked: boolean;
}

export interface SupportConversation {
    id: string;
    contact_id: string;
    status: SupportStatus;
    assigned_to: string | null;
    last_message_at: string;
    last_message_preview: string | null;
    unread_count: number;
    escalation_reason: string | null;
    resolved_at: string | null;
    closed_at: string | null;
    created_at: string;
    updated_at: string;
    contact: SupportContact;
}

export interface SupportMessage {
    id: number;
    conversation_id: string;
    direction: "inbound" | "outbound";
    sender_type: "parent" | "ai" | "superuser" | "system";
    sender_user_id: string | null;
    content: string;
    source_refs: string[];
    has_image?: boolean;
    reply_preview?: {
        message_id: number;
        sender_type: "parent" | "ai" | "superuser" | "system";
        text: string;
        has_image: boolean;
    } | null;
    telegram_delivery_status: string | null;
    telegram_receipt_status: SupportTelegramReceiptStatus | null;
    telegram_receipt_at: string | null;
    created_at: string;
}

export interface SupportKnowledge {
    id: string;
    title: string;
    category: string;
    content: string;
    status: "draft" | "published" | "archived";
    created_at: string;
    updated_at: string;
}

export interface SupportAnnouncement {
    id: string;
    title: string;
    content: string;
    programme: string;
    starts_on: string;
    ends_on: string;
    priority: number;
    status: "draft" | "published" | "archived";
    created_at: string;
    updated_at: string;
}
