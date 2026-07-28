"use client";

import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import AppHeader from "../components/AppHeader";
import CalendarPicker from "../components/CalendarPicker";
import type {
    SupportAnnouncement,
    SupportConversation,
    SupportKnowledge,
    SupportMessage,
    SupportStatus,
} from "../../types/support";
import { chatReturnPath } from "../lib/auth-return";
import { canCloseAfterCoachReply } from "../lib/support-conversation-policy";
import { normaliseCoachReferences } from "../lib/telegram-support-flow";
import "../styles.css";
import "../dashboard/dashboard.css";
import "./chats.css";

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type ChatsTab = "inbox" | "knowledge" | "announcements";

const statusLabels: Record<SupportStatus, string> = {
    ai_active: "AI active",
    waiting_parent: "Waiting for parent",
    escalated: "Escalated",
    human_active: "Coach Patrick active",
    resolved: "Closed",
    closed_parent: "Closed by parent",
};

const conversationModeCopy: Record<SupportStatus, { title: string; description: string }> = {
    ai_active: { title: "AI assistant is handling this conversation", description: "Coach Patrick can review the replies at any time. Taking over pauses the AI assistant." },
    waiting_parent: { title: "Waiting for the parent", description: "The AI assistant has replied and is waiting for the parent to continue the conversation." },
    escalated: { title: "Coach Patrick's attention is required", description: "The AI assistant has paused so Coach Patrick can review the conversation and reply personally." },
    human_active: { title: "Coach Patrick is handling this conversation", description: "The AI assistant is paused. Replies sent here are identified to the parent as coming from Coach Patrick." },
    resolved: { title: "Conversation closed", description: "Replies are paused. The parent can reopen it from Telegram, or you can reopen it here with the AI assistant." },
    closed_parent: { title: "Conversation closed by the parent", description: "The parent ended this conversation. Reopen as Coach Patrick only when a correction or important follow-up is needed." },
};

const senderDetails: Record<SupportMessage["sender_type"], { label: string; badge: string }> = {
    parent: { label: "Parent", badge: "Parent message" },
    ai: { label: "AI assistant", badge: "AI-generated reply" },
    superuser: { label: "Coach Patrick", badge: "Human reply" },
    system: { label: "System update", badge: "Status update" },
};

const todayKey = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const contactName = (conversation: SupportConversation) => {
    const contact = conversation.contact;
    return [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim()
        || (contact?.username ? `@${contact.username}` : "Telegram parent");
};

const formatTime = (value: string) => new Date(value).toLocaleString("en-SG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
});

const displayMessageContent = (message: SupportMessage) => {
    if (message.sender_type === "parent") return message.content;
    return normaliseCoachReferences(message.content);
};

const previousResponder = (messages: SupportMessage[], index: number) => {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        if (messages[cursor].sender_type === "ai" || messages[cursor].sender_type === "superuser") {
            return messages[cursor].sender_type;
        }
    }
    return null;
};

function MessageReplyPreview({
    preview,
    parentLabel,
    onOpenOriginal,
}: {
    preview: NonNullable<SupportMessage["reply_preview"]>;
    parentLabel: string;
    onOpenOriginal: (messageId: number) => void;
}) {
    const sender = senderDetails[preview.sender_type];
    const senderLabel = preview.sender_type === "parent" ? parentLabel : sender.label;
    const rawPreviewText = String(preview.text || "");
    const previewText = (
        preview.sender_type === "parent"
            ? rawPreviewText
            : normaliseCoachReferences(rawPreviewText)
    )
        .replace(/^\[Photo\]\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();
    const accessibleSummary = previewText
        || (preview.has_image ? "Photo" : "Message unavailable");

    return (
        <button
            type="button"
            className={`chats-quote chats-quote--${preview.sender_type}`}
            onClick={() => onOpenOriginal(preview.message_id)}
            aria-label={`Go to ${senderLabel}'s original message: ${accessibleSummary}`}
            title="Go to original message"
        >
            <span className="chats-quote__sender">{senderLabel}</span>
            <span className="chats-quote__body">
                {preview.has_image && (
                    <span className="chats-quote__media" aria-label="Photo">
                        Photo
                    </span>
                )}
                {previewText ? (
                    <span className="chats-quote__text">{previewText}</span>
                ) : !preview.has_image ? (
                    <span className="chats-quote__text">Message unavailable</span>
                ) : null}
            </span>
        </button>
    );
}

function highlightSearchMatch(value: string, query: string): ReactNode {
    const term = query.trim();
    if (!term) return value;

    const source = value.toLowerCase();
    const target = term.toLowerCase();
    const parts: ReactNode[] = [];
    let cursor = 0;
    let matchIndex = source.indexOf(target);

    while (matchIndex !== -1) {
        if (matchIndex > cursor) parts.push(value.slice(cursor, matchIndex));
        parts.push(
            <mark className="chats-search-highlight" key={`${matchIndex}-${value.slice(matchIndex, matchIndex + term.length)}`}>
                {value.slice(matchIndex, matchIndex + term.length)}
            </mark>,
        );
        cursor = matchIndex + term.length;
        matchIndex = source.indexOf(target, cursor);
    }

    if (cursor < value.length) parts.push(value.slice(cursor));
    return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
}

function ChatsNotification({
    kind,
    message,
    onDismiss,
}: {
    kind: "error" | "success";
    message: string;
    onDismiss: () => void;
}) {
    const [exiting, setExiting] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setExiting(true), 10000);
        return () => window.clearTimeout(timer);
    }, []);

    return (
        <div
            className={`${kind}-message chats-message${exiting ? " is-exiting" : ""}`}
            role={kind === "error" ? "alert" : "status"}
            onAnimationEnd={() => {
                if (exiting) onDismiss();
            }}
        >
            <span>{message}</span>
            <button
                type="button"
                className="chats-message__close"
                onClick={() => setExiting(true)}
                aria-label={kind === "error" ? "Dismiss error notification" : "Dismiss notification"}
            >
                ×
            </button>
        </div>
    );
}

function SupportImagePreview({
    messageId,
    getToken,
}: {
    messageId: number;
    getToken: () => Promise<string>;
}) {
    const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [imageUrl, setImageUrl] = useState("");
    const [retryNonce, setRetryNonce] = useState(0);
    const [requested, setRequested] = useState(false);
    const viewButtonRef = useRef<HTMLButtonElement>(null);

    const closeImage = useCallback(() => {
        setRequested(false);
        setState("idle");
        setImageUrl("");
        window.setTimeout(() => viewButtonRef.current?.focus(), 0);
    }, []);

    useEffect(() => {
        if (!requested) return;
        let cancelled = false;
        let objectUrl = "";

        const load = async () => {
            setState("loading");
            setImageUrl("");
            try {
                const accessToken = await getToken();
                const response = await fetch(`/api/support/image?message_id=${encodeURIComponent(String(messageId))}`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (!response.ok) {
                    const payload = await response.json().catch(() => null);
                    throw new Error(payload?.error || "Could not load the image.");
                }
                const image = await response.blob();
                objectUrl = URL.createObjectURL(image);
                if (cancelled) return;
                setImageUrl(objectUrl);
                setState("ready");
            } catch {
                if (!cancelled) setState("error");
            }
        };

        void load();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [getToken, messageId, requested, retryNonce]);

    if (state === "idle") {
        return (
            <div className="chats-image-state chats-image-state--sensitive">
                <button
                    ref={viewButtonRef}
                    type="button"
                    onClick={() => setRequested(true)}
                >
                    View parent image
                </button>
                <span>Loads only when you choose to view it.</span>
            </div>
        );
    }
    if (state === "loading") {
        return (
            <div
                className="chats-image-state"
                role="status"
                onKeyDown={(event) => {
                    if (event.key === "Escape") closeImage();
                }}
            >
                <span>Loading parent image…</span>
                <button type="button" onClick={closeImage}>Cancel</button>
            </div>
        );
    }
    if (state === "error") {
        return (
            <div
                className="chats-image-state chats-image-state--error"
                role="status"
                onKeyDown={(event) => {
                    if (event.key === "Escape") closeImage();
                }}
            >
                <span>Could not load this parent image.</span>
                <button
                    type="button"
                    onClick={() => {
                        setState("loading");
                        setRetryNonce((value) => value + 1);
                    }}
                >
                    Try again
                </button>
                <button type="button" onClick={closeImage}>Close image</button>
            </div>
        );
    }

    return (
        <div
            className="chats-image-preview"
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    closeImage();
                }
            }}
        >
            <a
                className="chats-image-preview__image-link"
                href={imageUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open parent image at full size"
            >
                <img src={imageUrl} alt="Image sent by parent" />
            </a>
            <div className="chats-image-preview__actions">
                <a href={imageUrl} target="_blank" rel="noreferrer">
                    Open full size
                </a>
                <button type="button" onClick={closeImage}>
                    Close image
                </button>
            </div>
        </div>
    );
}

export default function ChatsPage() {
    const router = useRouter();
    const messageEndRef = useRef<HTMLDivElement>(null);
    const selectedIdRef = useRef("");
    const conversationRequestRef = useRef(0);
    const foregroundConversationIdRef = useRef("");
    const loadedConversationIdRef = useRef("");
    const deleteDialogRef = useRef<HTMLElement>(null);
    const deleteTriggerRef = useRef<HTMLButtonElement>(null);
    const deleteCancelButtonRef = useRef<HTMLButtonElement>(null);
    const conversationListRef = useRef<HTMLElement>(null);
    const deleteCompletedRef = useRef(false);
    const busyRef = useRef(false);
    const deleteInFlightRef = useRef(false);
    const quoteHighlightTimerRef = useRef<number | null>(null);
    const quoteHighlightFrameRef = useRef<number | null>(null);
    const [userName, setUserName] = useState("");
    const [authorized, setAuthorized] = useState(false);
    const [tab, setTab] = useState<ChatsTab>("inbox");
    const [conversations, setConversations] = useState<SupportConversation[]>([]);
    const [knowledge, setKnowledge] = useState<SupportKnowledge[]>([]);
    const [announcements, setAnnouncements] = useState<SupportAnnouncement[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [selectedConversation, setSelectedConversation] = useState<SupportConversation | null>(null);
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [conversationLoadingId, setConversationLoadingId] = useState("");
    const [conversationLoadFailedId, setConversationLoadFailedId] = useState("");
    const [requestedConversationMissing, setRequestedConversationMissing] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<SupportConversation | null>(null);
    const [deleteConversationError, setDeleteConversationError] = useState("");
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [knowledgeSearch, setKnowledgeSearch] = useState("");
    const [announcementSearch, setAnnouncementSearch] = useState("");
    const [reply, setReply] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
    busyRef.current = busy;

    const [knowledgeForm, setKnowledgeForm] = useState({
        id: "",
        title: "",
        category: "General",
        content: "",
        status: "draft" as SupportKnowledge["status"],
    });
    const [announcementForm, setAnnouncementForm] = useState({
        id: "",
        title: "",
        content: "",
        programme: "all",
        startsOn: todayKey(),
        endsOn: todayKey(),
        status: "draft" as SupportAnnouncement["status"],
    });

    const token = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Please sign in again.");
        return session.access_token;
    }, []);

    const supportFetch = useCallback(async (url: string, options?: RequestInit) => {
        const accessToken = await token();
        const response = await fetch(url, {
            ...options,
            headers: {
                ...(options?.body ? { "Content-Type": "application/json" } : {}),
                Authorization: `Bearer ${accessToken}`,
                ...(options?.headers || {}),
            },
        });
        const data = await response.json();
        if (!response.ok) {
            const requestError = new Error(data.error || "Support request failed.") as Error & { status?: number };
            requestError.status = response.status;
            throw requestError;
        }
        return data;
    }, [token]);

    const openQuotedMessage = useCallback((messageId: number) => {
        const normalizedMessageId = Number(messageId);
        if (!Number.isSafeInteger(normalizedMessageId) || normalizedMessageId <= 0) return;
        const target = document.getElementById(`support-message-${normalizedMessageId}`);
        if (!target) return;

        if (quoteHighlightTimerRef.current !== null) {
            window.clearTimeout(quoteHighlightTimerRef.current);
        }
        if (quoteHighlightFrameRef.current !== null) {
            window.cancelAnimationFrame(quoteHighlightFrameRef.current);
        }
        setHighlightedMessageId(null);
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        quoteHighlightFrameRef.current = window.requestAnimationFrame(() => {
            setHighlightedMessageId(normalizedMessageId);
            quoteHighlightFrameRef.current = null;
            quoteHighlightTimerRef.current = window.setTimeout(() => {
                setHighlightedMessageId(null);
                quoteHighlightTimerRef.current = null;
            }, 1800);
        });
    }, []);

    useEffect(() => () => {
        if (quoteHighlightTimerRef.current !== null) {
            window.clearTimeout(quoteHighlightTimerRef.current);
        }
        if (quoteHighlightFrameRef.current !== null) {
            window.cancelAnimationFrame(quoteHighlightFrameRef.current);
        }
    }, []);

    const selectConversation = useCallback((conversationId: string) => {
        if (!conversationId) return;
        if (conversationId === selectedIdRef.current) return;
        selectedIdRef.current = conversationId;
        foregroundConversationIdRef.current = conversationId;
        loadedConversationIdRef.current = "";
        conversationRequestRef.current += 1;
        setSelectedId(conversationId);
        setSelectedConversation(null);
        setMessages([]);
        setReply("");
        setConversationLoadingId(conversationId);
        setConversationLoadFailedId("");
        setRequestedConversationMissing(false);
        setDeleteTarget(null);
        setDeleteConversationError("");
        setError("");
    }, []);

    const loadSummary = useCallback(async (showLoader = false) => {
        if (showLoader) setLoading(true);
        try {
            const data = await supportFetch("/api/support");
            const nextConversations: SupportConversation[] = data.conversations || [];
            setConversations(nextConversations);
            setKnowledge(data.knowledge || []);
            setAnnouncements(data.announcements || []);
            setError("");

            const activeConversationId = selectedIdRef.current;
            if (
                activeConversationId
                && !nextConversations.some((item) => item.id === activeConversationId)
            ) {
                conversationRequestRef.current += 1;
                selectedIdRef.current = "";
                foregroundConversationIdRef.current = "";
                loadedConversationIdRef.current = "";
                setSelectedId("");
                setSelectedConversation(null);
                setMessages([]);
                setReply("");
                setConversationLoadingId("");
                setConversationLoadFailedId("");
                setRequestedConversationMissing(false);
                setDeleteTarget(null);
                setDeleteConversationError("");
            }

            if (!selectedIdRef.current) {
                const requestedId = new URLSearchParams(window.location.search).get("conversation");
                if (requestedId) {
                    const requestedConversation = nextConversations.find(
                        (item: SupportConversation) => item.id === requestedId,
                    );
                    if (requestedConversation) {
                        selectConversation(requestedConversation.id);
                    } else {
                        setRequestedConversationMissing(true);
                    }
                } else if (nextConversations.length) {
                    selectConversation(nextConversations[0].id);
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not load Chats.");
        } finally {
            if (showLoader) setLoading(false);
        }
    }, [selectConversation, supportFetch]);

    const loadConversation = useCallback(async (conversationId: string, showLoader = false) => {
        if (!conversationId || selectedIdRef.current !== conversationId) return;
        if (!showLoader && foregroundConversationIdRef.current === conversationId) return;
        const requestId = ++conversationRequestRef.current;
        if (showLoader) {
            foregroundConversationIdRef.current = conversationId;
            setConversationLoadingId(conversationId);
            setConversationLoadFailedId("");
        }
        try {
            const data = await supportFetch(`/api/support?conversation_id=${encodeURIComponent(conversationId)}`);
            if (requestId !== conversationRequestRef.current || selectedIdRef.current !== conversationId) return;
            if (data.conversation?.id !== conversationId) throw new Error("The server returned a different conversation.");
            loadedConversationIdRef.current = conversationId;
            setSelectedConversation(data.conversation);
            setMessages(data.messages || []);
            if (["resolved", "closed_parent"].includes(data.conversation.status)) setReply("");
            setConversationLoadFailedId("");
            setError("");
            setConversations((previous) => previous.map((item) =>
                item.id === conversationId ? { ...item, ...data.conversation, unread_count: 0 } : item,
            ));
        } catch (err) {
            if (requestId !== conversationRequestRef.current || selectedIdRef.current !== conversationId) return;
            if (showLoader || loadedConversationIdRef.current !== conversationId) {
                setConversationLoadFailedId(conversationId);
            }
            setError(err instanceof Error ? err.message : "Could not load the conversation.");
        } finally {
            if (
                showLoader
                && requestId === conversationRequestRef.current
                && foregroundConversationIdRef.current === conversationId
            ) {
                foregroundConversationIdRef.current = "";
            }
            if (requestId === conversationRequestRef.current && selectedIdRef.current === conversationId) {
                setConversationLoadingId((current) => current === conversationId ? "" : current);
            }
        }
    }, [supportFetch]);

    useEffect(() => {
        const initialise = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                const requestedPath = chatReturnPath(
                    new URLSearchParams(window.location.search).get("conversation"),
                );
                router.replace(requestedPath ? `/?next=${encodeURIComponent(requestedPath)}` : "/");
                return;
            }
            const role = user.app_metadata?.role || user.user_metadata?.role || "member";
            if (role !== "superuser") {
                router.replace("/dashboard");
                return;
            }
            setUserName(user.user_metadata?.name || user.email || "User");
            setAuthorized(true);
        };
        void initialise();
    }, [router]);

    useEffect(() => {
        if (authorized) void loadSummary(true);
    }, [authorized, loadSummary]);

    useEffect(() => {
        if (selectedId) void loadConversation(selectedId, true);
    }, [loadConversation, selectedId]);

    useEffect(() => {
        if (!deleteTarget) return;
        const previousOverflow = document.body.style.overflow;
        const previousPosition = document.body.style.position;
        const previousTop = document.body.style.top;
        const previousWidth = document.body.style.width;
        const scrollPosition = window.scrollY;
        const focusFrame = window.requestAnimationFrame(() => deleteCancelButtonRef.current?.focus());
        const handleDialogKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !busyRef.current) {
                setDeleteTarget(null);
                setDeleteConversationError("");
                return;
            }
            if (event.key === "Tab") {
                const dialog = deleteDialogRef.current;
                const focusable = Array.from(
                    dialog?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [],
                );
                if (!focusable.length) {
                    event.preventDefault();
                    dialog?.focus();
                    return;
                }
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (!dialog?.contains(document.activeElement)) {
                    event.preventDefault();
                    first.focus();
                } else if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        document.body.style.overflow = "hidden";
        document.body.style.position = "fixed";
        document.body.style.top = `-${scrollPosition}px`;
        document.body.style.width = "100%";
        document.addEventListener("keydown", handleDialogKey);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.body.style.overflow = previousOverflow;
            document.body.style.position = previousPosition;
            document.body.style.top = previousTop;
            document.body.style.width = previousWidth;
            window.scrollTo(0, scrollPosition);
            document.removeEventListener("keydown", handleDialogKey);
            const deletionCompleted = deleteCompletedRef.current;
            window.requestAnimationFrame(() => {
                if (deletionCompleted || !deleteTriggerRef.current) {
                    conversationListRef.current?.focus();
                } else {
                    deleteTriggerRef.current?.focus();
                }
                deleteCompletedRef.current = false;
            });
        };
    }, [deleteTarget]);

    useEffect(() => {
        if (!authorized) return;
        const interval = window.setInterval(() => {
            void loadSummary(false);
            const activeConversationId = selectedIdRef.current;
            if (activeConversationId && tab === "inbox") void loadConversation(activeConversationId, false);
        }, 10000);
        return () => window.clearInterval(interval);
    }, [authorized, loadConversation, loadSummary, tab]);

    useEffect(() => {
        messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages]);

    const runAction = async (payload: Record<string, unknown>, message?: string) => {
        setBusy(true);
        setError("");
        setSuccess("");
        try {
            const result = await supportFetch("/api/support", { method: "POST", body: JSON.stringify(payload) });
            if (message) setSuccess(message);
            await loadSummary(false);
            const activeConversationId = selectedIdRef.current;
            if (activeConversationId) await loadConversation(activeConversationId, false);
            if (result.warning) setError(String(result.warning));
            return true;
        } catch (err) {
            setError(err instanceof Error ? err.message : "The action failed.");
            return false;
        } finally {
            setBusy(false);
        }
    };

    const sendReply = async (event: React.FormEvent) => {
        event.preventDefault();
        const content = reply.trim();
        const conversationId = selectedIdRef.current;
        if (!content || !conversationId) return;
        const latestParentMessage = [...messages]
            .reverse()
            .find((message) => message.sender_type === "parent");
        const sent = await runAction({
            action: "send_message",
            conversationId,
            content,
            expectedParentMessageId: latestParentMessage?.id ?? "",
        });
        if (sent) setReply("");
    };

    const changeStatus = (status: SupportStatus, reason: string) => {
        const conversationId = selectedIdRef.current;
        if (!conversationId) return Promise.resolve(false);
        return runAction({ action: "set_status", conversationId, status, reason }, `Conversation marked ${statusLabels[status].toLowerCase()}.`);
    };

    const confirmResolution = () => {
        if (!selectedConversation) return;
        if (!window.confirm("Close this conversation? The full history will remain available, and the parent can reopen it from Telegram.")) return;
        void changeStatus("resolved", "Conversation closed by Coach Patrick.");
    };

    const reopenResolvedConversation = () => {
        if (selectedConversation?.status !== "resolved") return;
        if (!window.confirm("Reopen this conversation with the AI assistant? The parent will be able to continue messaging.")) return;
        void changeStatus("ai_active", "Closed conversation reopened with the AI assistant by Coach Patrick.");
    };

    const reopenAsCoachPatrick = () => {
        if (!selectedConversation || !["resolved", "closed_parent"].includes(selectedConversation.status)) return;
        if (!window.confirm("Reopen this conversation as Coach Patrick? The parent will be notified, and the AI will stay paused while you send a follow-up.")) return;
        void changeStatus("human_active", "Closed conversation reopened by Coach Patrick for a follow-up.");
    };

    const openConversationDeletion = () => {
        if (!selectedConversation || busy) return;
        deleteCompletedRef.current = false;
        setDeleteConversationError("");
        setDeleteTarget(selectedConversation);
    };

    const cancelConversationDeletion = () => {
        if (busy) return;
        setDeleteTarget(null);
        setDeleteConversationError("");
    };

    const clearConversationFromView = (conversationId: string) => {
        if (selectedIdRef.current === conversationId) {
            conversationRequestRef.current += 1;
            selectedIdRef.current = "";
            foregroundConversationIdRef.current = "";
            loadedConversationIdRef.current = "";
            setSelectedId("");
            setSelectedConversation(null);
            setMessages([]);
            setReply("");
            setConversationLoadingId("");
            setConversationLoadFailedId("");
            setRequestedConversationMissing(false);
        }
        const deepLinkedConversation = new URLSearchParams(window.location.search).get("conversation");
        if (deepLinkedConversation === conversationId) {
            window.history.replaceState(window.history.state, "", "/chats");
        }
    };

    const confirmConversationDeletion = async () => {
        const target = deleteTarget;
        if (!target || busy || deleteInFlightRef.current) return;
        deleteInFlightRef.current = true;
        deleteDialogRef.current?.focus();
        setBusy(true);
        setError("");
        setSuccess("");
        setDeleteConversationError("");
        try {
            await supportFetch("/api/support", {
                method: "POST",
                body: JSON.stringify({
                    action: "delete_conversation",
                    conversationId: target.id,
                    expectedUpdatedAt: target.updated_at,
                }),
            });

            clearConversationFromView(target.id);
            deleteCompletedRef.current = true;
            setDeleteTarget(null);
            setSuccess(`Conversation with ${contactName(target)} permanently deleted.`);
            await loadSummary(false);
        } catch (err) {
            const message = err instanceof Error ? err.message : "The conversation could not be deleted.";
            const status = err instanceof Error
                ? (err as Error & { status?: number }).status
                : undefined;
            if (status === 409) {
                setDeleteTarget(null);
                setDeleteConversationError("");
                setError(`${message} Open Delete conversation again after reviewing the latest conversation.`);
                if (selectedIdRef.current === target.id) {
                    await loadConversation(target.id, true);
                    window.requestAnimationFrame(() => deleteTriggerRef.current?.focus());
                }
            } else if (status === 404) {
                clearConversationFromView(target.id);
                deleteCompletedRef.current = true;
                setDeleteTarget(null);
                setDeleteConversationError("");
                setSuccess("This conversation had already been removed.");
                await loadSummary(false);
            } else {
                setDeleteConversationError(message);
                setError(message);
            }
        } finally {
            deleteInFlightRef.current = false;
            setBusy(false);
            window.requestAnimationFrame(() => deleteCancelButtonRef.current?.focus());
        }
    };

    const resetKnowledgeForm = () => setKnowledgeForm({ id: "", title: "", category: "General", content: "", status: "draft" });
    const saveKnowledge = async (event: React.FormEvent) => {
        event.preventDefault();
        const saved = await runAction({ action: "save_knowledge", ...knowledgeForm }, knowledgeForm.id ? "Knowledge updated." : "Knowledge added.");
        if (saved) resetKnowledgeForm();
    };

    const resetAnnouncementForm = () => setAnnouncementForm({
        id: "", title: "", content: "", programme: "all", startsOn: todayKey(), endsOn: todayKey(), status: "draft",
    });
    const saveAnnouncement = async (event: React.FormEvent) => {
        event.preventDefault();
        const saved = await runAction({ action: "save_announcement", ...announcementForm }, announcementForm.id ? "Announcement updated." : "Announcement added.");
        if (saved) resetAnnouncementForm();
    };

    const filteredConversations = useMemo(() => conversations.filter((conversation) => {
        const term = search.trim().toLowerCase();
        const matchesSearch = !term || `${contactName(conversation)} ${conversation.contact?.username || ""} ${conversation.last_message_preview || ""}`.toLowerCase().includes(term);
        return matchesSearch && (statusFilter === "all" || conversation.status === statusFilter);
    }), [conversations, search, statusFilter]);

    const filteredKnowledge = useMemo(() => {
        const term = knowledgeSearch.trim().toLowerCase();
        if (!term) return knowledge;
        return knowledge.filter((item) =>
            `${item.title} ${item.content} ${item.category} ${item.status}`.toLowerCase().includes(term),
        );
    }, [knowledge, knowledgeSearch]);

    const filteredAnnouncements = useMemo(() => {
        const term = announcementSearch.trim().toLowerCase();
        if (!term) return announcements;
        return announcements.filter((item) =>
            `${item.title} ${item.content} ${item.programme} ${item.status}`.toLowerCase().includes(term),
        );
    }, [announcements, announcementSearch]);

    const counts = useMemo(() => ({
        escalated: conversations.filter((item) => item.status === "escalated").length,
        human: conversations.filter((item) => item.status === "human_active").length,
        unread: conversations.reduce((sum, item) => sum + Number(item.unread_count || 0), 0),
    }), [conversations]);

    const selectedConversationSummary = useMemo(
        () => conversations.find((item) => item.id === selectedId) || null,
        [conversations, selectedId],
    );
    const canCloseConversation = useMemo(
        () => canCloseAfterCoachReply(messages),
        [messages],
    );
    const selectedConversationName = selectedConversationSummary ? contactName(selectedConversationSummary) : "this parent";
    const selectedConversationIsLoading = Boolean(
        selectedId
        && conversationLoadFailedId !== selectedId
        && (conversationLoadingId === selectedId || selectedConversation?.id !== selectedId)
    );
    const selectedConversationLoadFailed = Boolean(selectedId && conversationLoadFailedId === selectedId);

    if (!authorized) return <div className="container"><p className="chats-loading">Checking access…</p></div>;

    return (
        <div className="container chats-page">
            <AppHeader title="Parent Chats" userName={userName} userRole="superuser" mode="dashboard" />
            <main className="chats-main">
                <section className="chats-hero">
                    <div>
                        <span className="chats-eyebrow">Telegram parent support</span>
                        <h1>Conversations and current information</h1>
                        <p>Review AI replies, take over escalated chats, and keep the chatbot&apos;s coaching information up to date.</p>
                    </div>
                    <div className="chats-metrics" aria-label="Conversation summary">
                        <div><strong>{counts.escalated}</strong><span>Escalated</span></div>
                        <div><strong>{counts.human}</strong><span>Coach Patrick active</span></div>
                        <div><strong>{counts.unread}</strong><span>Unread</span></div>
                    </div>
                </section>

                <nav className="chats-tabs" aria-label="Chats sections">
                    {(["inbox", "knowledge", "announcements"] as ChatsTab[]).map((item) => (
                        <button key={item} type="button" className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>
                            {item === "inbox" ? "Inbox" : item.charAt(0).toUpperCase() + item.slice(1)}
                            {item === "inbox" && counts.escalated > 0 && <span>{counts.escalated}</span>}
                        </button>
                    ))}
                </nav>

                {error && (
                    <ChatsNotification key={`error-${error}`} kind="error" message={error} onDismiss={() => setError("")} />
                )}
                {success && (
                    <ChatsNotification key={`success-${success}`} kind="success" message={success} onDismiss={() => setSuccess("")} />
                )}

                {tab === "inbox" && (
                    <section className="chats-inbox">
                        <aside
                            ref={conversationListRef}
                            className="chats-conversation-list"
                            aria-label="Parent conversations"
                            tabIndex={-1}
                        >
                            <div className="chats-list-tools">
                                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search parents or messages…" aria-label="Search conversations" />
                                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
                                    <option value="all">All statuses</option>
                                    {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                            </div>
                            <div className="chats-list-scroll">
                                {loading ? <p className="chats-empty">Loading conversations…</p> : filteredConversations.length === 0 ? (
                                    <p className="chats-empty">No matching conversations yet.</p>
                                ) : filteredConversations.map((conversation) => (
                                    <button
                                        type="button"
                                        key={conversation.id}
                                        className={`chats-conversation${selectedId === conversation.id ? " is-selected" : ""}`}
                                        onClick={() => selectConversation(conversation.id)}
                                    >
                                        <span className="chats-parent-avatar">{contactName(conversation).charAt(0).toUpperCase()}</span>
                                        <span className="chats-conversation-copy">
                                            <span className="chats-conversation-top"><strong>{contactName(conversation)}</strong><time>{formatTime(conversation.last_message_at)}</time></span>
                                            <span className={`chats-status chats-status--${conversation.status}`}>{statusLabels[conversation.status]}</span>
                                            <span className="chats-preview">{conversation.last_message_preview || "Conversation started"}</span>
                                        </span>
                                        {conversation.unread_count > 0 && <span className="chats-unread">{conversation.unread_count}</span>}
                                    </button>
                                ))}
                            </div>
                        </aside>

                        <div className="chats-thread">
                            {selectedConversationIsLoading ? (
                                <div className="chats-thread-state" role="status" aria-live="polite" aria-busy="true">
                                    <span className="chats-thread-spinner" aria-hidden="true" />
                                    <div>
                                        <h2>Loading conversation with {selectedConversationName}…</h2>
                                        <p>Getting the latest messages and conversation status.</p>
                                    </div>
                                </div>
                            ) : selectedConversationLoadFailed ? (
                                <div className="chats-thread-state chats-thread-state--error" role="alert">
                                    <div>
                                        <h2>Could not load the conversation with {selectedConversationName}</h2>
                                        <p>Select Try again to fetch the latest messages.</p>
                                        <button type="button" onClick={() => void loadConversation(selectedId, true)}>Try again</button>
                                    </div>
                                </div>
                            ) : requestedConversationMissing ? (
                                <div className="chats-thread-empty">
                                    <h2>Conversation not found</h2>
                                    <p>This chat may no longer be available, or your link may be out of date. Select another conversation from the list.</p>
                                </div>
                            ) : !selectedConversation ? (
                                <div className="chats-thread-empty"><h2>Select a conversation</h2><p>The full Telegram history will appear here.</p></div>
                            ) : (
                                <>
                                    <header className="chats-thread-header">
                                        <div>
                                            <h2>{contactName(selectedConversation)}</h2>
                                            <p>{selectedConversation.contact?.username ? `@${selectedConversation.contact.username}` : "No Telegram username"} · Telegram ID {selectedConversation.contact?.telegram_user_id || "Unavailable"}</p>
                                        </div>
                                        <span className={`chats-status chats-status--${selectedConversation.status}`}>{statusLabels[selectedConversation.status]}</span>
                                    </header>
                                    {selectedConversation.escalation_reason && (
                                        <div className="chats-escalation"><strong>Escalation reason</strong><span>{selectedConversation.escalation_reason}</span></div>
                                    )}
                                    <div className={`chats-mode chats-mode--${selectedConversation.status}`}>
                                        <span className="chats-mode__icon" aria-hidden="true">
                                            {selectedConversation.status === "human_active" || selectedConversation.status === "escalated" ? "P" : selectedConversation.status === "resolved" || selectedConversation.status === "closed_parent" ? "✓" : "AI"}
                                        </span>
                                        <span>
                                            <strong>{conversationModeCopy[selectedConversation.status].title}</strong>
                                            <small>{conversationModeCopy[selectedConversation.status].description}</small>
                                        </span>
                                    </div>
                                    <div className="chats-thread-actions">
                                            {["resolved", "closed_parent"].includes(selectedConversation.status) ? (
                                                <>
                                                    <button type="button" className="is-primary" onClick={reopenAsCoachPatrick} disabled={busy}>Reopen as Coach Patrick</button>
                                                    {selectedConversation.status === "resolved" && (
                                                        <button type="button" onClick={reopenResolvedConversation} disabled={busy}>Reopen with AI</button>
                                                    )}
                                                </>
                                            ) : (
                                                <>
                                                    {selectedConversation.status !== "human_active" && (
                                                        <button type="button" className="is-primary" onClick={() => void changeStatus("human_active", "Coach Patrick took over the conversation.")} disabled={busy}>Take over as Coach Patrick</button>
                                                    )}
                                                    {["escalated", "human_active"].includes(selectedConversation.status) && (
                                                        <button type="button" onClick={() => void changeStatus("ai_active", "Returned to the AI assistant by Coach Patrick.")} disabled={busy}>Return to AI</button>
                                                    )}
                                                    {selectedConversation.status === "human_active" && canCloseConversation && (
                                                        <button type="button" className="is-resolve" onClick={confirmResolution} disabled={busy}>Close conversation</button>
                                                    )}
                                                </>
                                            )}
                                            <button
                                                ref={deleteTriggerRef}
                                                type="button"
                                                className="is-destructive chats-delete-trigger"
                                                onClick={openConversationDeletion}
                                                disabled={busy}
                                            >
                                                Delete conversation
                                            </button>
                                        </div>
                                    <div className="chats-messages" aria-live="polite">
                                        {messages.map((message, index) => {
                                            const sender = senderDetails[message.sender_type];
                                            const priorResponder = previousResponder(messages, index);
                                            const startsHumanTakeover = message.sender_type === "superuser" && priorResponder !== "superuser";
                                            const resumesAi = message.sender_type === "ai" && priorResponder === "superuser";

                                            return (
                                                <Fragment key={message.id}>
                                                    {(startsHumanTakeover || resumesAi) && (
                                                        <div className={`chats-handoff chats-handoff--${startsHumanTakeover ? "human" : "ai"}`}>
                                                            <span aria-hidden="true">{startsHumanTakeover ? "P" : "AI"}</span>
                                                            <strong>{startsHumanTakeover ? "Coach Patrick joined the conversation" : "AI assistant resumed the conversation"}</strong>
                                                        </div>
                                                    )}
                                                    <article
                                                        id={`support-message-${message.id}`}
                                                        className={`chats-bubble chats-bubble--${message.sender_type}${highlightedMessageId === message.id ? " is-quote-target" : ""}`}
                                                        tabIndex={-1}
                                                    >
                                                        <div className="chats-bubble-meta">
                                                            <span className="chats-sender">
                                                                <strong>{message.sender_type === "parent" ? contactName(selectedConversation) : sender.label}</strong>
                                                                <span className={`chats-sender-badge chats-sender-badge--${message.sender_type}`}>{sender.badge}</span>
                                                            </span>
                                                            <time>{formatTime(message.created_at)}</time>
                                                        </div>
                                                        {message.reply_preview && (
                                                            <MessageReplyPreview
                                                                preview={message.reply_preview}
                                                                parentLabel={contactName(selectedConversation)}
                                                                onOpenOriginal={openQuotedMessage}
                                                            />
                                                        )}
                                                        <p>{displayMessageContent(message)}</p>
                                                        {message.has_image && <SupportImagePreview messageId={message.id} getToken={token} />}
                                                        {message.source_refs?.length > 0 && <small>Sources: {message.source_refs.join(", ")}</small>}
                                                    </article>
                                                </Fragment>
                                            );
                                        })}
                                        <div ref={messageEndRef} />
                                    </div>
                                    {["resolved", "closed_parent"].includes(selectedConversation.status) ? (
                                        <div className={`chats-reply-closed chats-reply-closed--${selectedConversation.status}`} role="status" aria-live="polite">
                                            <span className="chats-reply-closed__icon" aria-hidden="true">Closed</span>
                                            <span className="chats-reply-closed__copy">
                                                <strong>{selectedConversation.status === "closed_parent" ? "The parent closed this conversation" : "This conversation is closed"}</strong>
                                                <span>{selectedConversation.status === "closed_parent" ? "Replies are disabled. The parent can reopen it, or you can reopen as Coach Patrick for an important correction or follow-up." : "Replies are disabled until you reopen the conversation above."}</span>
                                            </span>
                                        </div>
                                    ) : (
                                        <form className="chats-reply" onSubmit={sendReply}>
                                            <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to this parent through Telegram…" rows={3} maxLength={3900} disabled={busy || selectedConversation.contact?.blocked} />
                                            <div>
                                                <span>{selectedConversation.status === "human_active" ? "AI is paused. This will be sent as Coach Patrick." : "Sending this reply will pause the AI and identify it as Coach Patrick."}</span>
                                                <button type="submit" className="submit-btn" disabled={busy || !reply.trim() || selectedConversation.contact?.blocked}>{busy ? "Sending…" : "Send as Coach Patrick"}</button>
                                            </div>
                                        </form>
                                    )}
                                </>
                            )}
                        </div>
                    </section>
                )}

                {tab === "knowledge" && (
                    <section className="chats-editor-layout">
                        <form className="chats-editor" onSubmit={saveKnowledge}>
                            <div className="chats-section-heading"><div><span className="chats-eyebrow">Chatbot knowledge</span><h2>{knowledgeForm.id ? "Edit knowledge" : "Add knowledge"}</h2><p>Published entries can be used immediately in parent answers.</p></div></div>
                            <label>Title<input value={knowledgeForm.title} onChange={(event) => setKnowledgeForm((form) => ({ ...form, title: event.target.value }))} placeholder="e.g. Weekend training fees" /></label>
                            <label>Category<input value={knowledgeForm.category} onChange={(event) => setKnowledgeForm((form) => ({ ...form, category: event.target.value }))} placeholder="General" /></label>
                            <label>Information<textarea value={knowledgeForm.content} onChange={(event) => setKnowledgeForm((form) => ({ ...form, content: event.target.value }))} rows={8} placeholder="Write the exact information the chatbot may use…" /></label>
                            <label>Status<select value={knowledgeForm.status} onChange={(event) => setKnowledgeForm((form) => ({ ...form, status: event.target.value as SupportKnowledge["status"] }))}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
                            <div className="chats-form-actions">{knowledgeForm.id && <button type="button" className="cancel-btn" onClick={resetKnowledgeForm}>Cancel edit</button>}<button type="submit" className="submit-btn" disabled={busy}>{busy ? "Saving…" : "Save knowledge"}</button></div>
                        </form>
                        <div className="chats-record-list">
                            <div className="chats-record-search">
                                <input value={knowledgeSearch} onChange={(event) => setKnowledgeSearch(event.target.value)} placeholder="Search title, information, category or status…" aria-label="Search knowledge" />
                                <span>{filteredKnowledge.length} of {knowledge.length}</span>
                            </div>
                            {knowledge.length === 0 ? <p className="chats-empty-card">No knowledge has been added. The chatbot will escalate rather than guess.</p> : filteredKnowledge.length === 0 ? <p className="chats-empty-card">No knowledge matches your search.</p> : filteredKnowledge.map((item) => (
                                <article key={item.id} className="chats-record-card">
                                    <div><span className={`chats-record-status is-${item.status}`}>{highlightSearchMatch(item.status, knowledgeSearch)}</span><small>{highlightSearchMatch(item.category, knowledgeSearch)}</small></div>
                                    <h3>{highlightSearchMatch(item.title, knowledgeSearch)}</h3><p>{highlightSearchMatch(item.content, knowledgeSearch)}</p><time>Updated {formatTime(item.updated_at)}</time>
                                    <div className="chats-record-actions"><button type="button" onClick={() => setKnowledgeForm({ id: item.id, title: item.title, category: item.category, content: item.content, status: item.status })}>Edit</button><button type="button" className="is-destructive" onClick={() => confirm(`Delete “${item.title}”?`) && void runAction({ action: "delete_knowledge", id: item.id }, "Knowledge deleted.")}>Delete</button></div>
                                </article>
                            ))}
                        </div>
                    </section>
                )}

                {tab === "announcements" && (
                    <section className="chats-editor-layout">
                        <form className="chats-editor" onSubmit={saveAnnouncement}>
                            <div className="chats-section-heading"><div><span className="chats-eyebrow">Time-sensitive information</span><h2>{announcementForm.id ? "Edit announcement" : "Add announcement"}</h2><p>Active published announcements override general knowledge.</p></div></div>
                            <label>Title<input value={announcementForm.title} onChange={(event) => setAnnouncementForm((form) => ({ ...form, title: event.target.value }))} placeholder="e.g. National Day training continues" /></label>
                            <label>Programme<select value={announcementForm.programme} onChange={(event) => setAnnouncementForm((form) => ({ ...form, programme: event.target.value }))}><option value="all">All programmes</option><option value="weekend">Weekend</option><option value="weekday">Weekday</option><option value="matchplay">MatchPlay</option><option value="1-1">1-1</option></select></label>
                            <div className="chats-date-grid"><label>Starts on<CalendarPicker mode="date" value={announcementForm.startsOn} onChange={(value) => setAnnouncementForm((form) => ({ ...form, startsOn: value }))} ariaLabel="Announcement start date" /></label><label>Ends on<CalendarPicker mode="date" value={announcementForm.endsOn} onChange={(value) => setAnnouncementForm((form) => ({ ...form, endsOn: value }))} ariaLabel="Announcement end date" /></label></div>
                            <label>Announcement<textarea value={announcementForm.content} onChange={(event) => setAnnouncementForm((form) => ({ ...form, content: event.target.value }))} rows={6} placeholder="State exactly what parents should be told…" /></label>
                            <label>Status<select value={announcementForm.status} onChange={(event) => setAnnouncementForm((form) => ({ ...form, status: event.target.value as SupportAnnouncement["status"] }))}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
                            <div className="chats-form-actions">{announcementForm.id && <button type="button" className="cancel-btn" onClick={resetAnnouncementForm}>Cancel edit</button>}<button type="submit" className="submit-btn" disabled={busy}>{busy ? "Saving…" : "Save announcement"}</button></div>
                        </form>
                        <div className="chats-record-list">
                            <div className="chats-record-search">
                                <input value={announcementSearch} onChange={(event) => setAnnouncementSearch(event.target.value)} placeholder="Search title, announcement, programme or status…" aria-label="Search announcements" />
                                <span>{filteredAnnouncements.length} of {announcements.length}</span>
                            </div>
                            {announcements.length === 0 ? <p className="chats-empty-card">No announcements yet. Add dated holiday or operational information here.</p> : filteredAnnouncements.length === 0 ? <p className="chats-empty-card">No announcements match your search.</p> : filteredAnnouncements.map((item) => (
                                <article key={item.id} className="chats-record-card">
                                    <div><span className={`chats-record-status is-${item.status}`}>{highlightSearchMatch(item.status, announcementSearch)}</span><small>{highlightSearchMatch(item.programme, announcementSearch)}</small></div>
                                    <h3>{highlightSearchMatch(item.title, announcementSearch)}</h3><p>{highlightSearchMatch(item.content, announcementSearch)}</p><time>{item.starts_on} to {item.ends_on} · Updated {formatTime(item.updated_at)}</time>
                                    <div className="chats-record-actions"><button type="button" onClick={() => setAnnouncementForm({ id: item.id, title: item.title, content: item.content, programme: item.programme, startsOn: item.starts_on, endsOn: item.ends_on, status: item.status })}>Edit</button><button type="button" className="is-destructive" onClick={() => confirm(`Delete “${item.title}”?`) && void runAction({ action: "delete_announcement", id: item.id }, "Announcement deleted.")}>Delete</button></div>
                                </article>
                            ))}
                        </div>
                    </section>
                )}
            </main>

            {deleteTarget && (
                <div
                    className="chats-delete-modal__backdrop"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.currentTarget === event.target) cancelConversationDeletion();
                    }}
                >
                    <section
                        ref={deleteDialogRef}
                        className="chats-delete-modal"
                        role="dialog"
                        tabIndex={-1}
                        aria-modal="true"
                        aria-labelledby="delete-conversation-title"
                        aria-describedby={[
                            "delete-conversation-description",
                            !["resolved", "closed_parent"].includes(deleteTarget.status)
                                ? "delete-conversation-active-warning"
                                : "",
                            "delete-conversation-scope",
                        ].filter(Boolean).join(" ")}
                    >
                        <header className="chats-delete-modal__header">
                            <span className="chats-delete-modal__icon" aria-hidden="true">!</span>
                            <div>
                                <span className="chats-eyebrow">Permanent action</span>
                                <h2 id="delete-conversation-title">Delete this conversation?</h2>
                            </div>
                        </header>
                        <div className="chats-delete-modal__body">
                            <p id="delete-conversation-description">
                                You are permanently deleting the stored conversation with <strong>{contactName(deleteTarget)}</strong>.
                                This cannot be undone.
                            </p>
                            {!["resolved", "closed_parent"].includes(deleteTarget.status) && (
                                <p id="delete-conversation-active-warning" className="chats-delete-modal__active-warning">
                                    This conversation is currently active. Deleting it ends the current support flow immediately;
                                    the parent's next message will begin a new conversation.
                                </p>
                            )}
                            <ul id="delete-conversation-scope">
                                <li>All stored messages, image references and status history for this conversation will be removed.</li>
                                <li>The parent contact remains, so their next message will start a fresh conversation.</li>
                                <li>Messages already visible in Telegram and previously exported audit records are not removed.</li>
                            </ul>
                            {busy && (
                                <p className="chats-delete-modal__progress" role="status" aria-live="polite">
                                    Deleting conversation…
                                </p>
                            )}
                            {deleteConversationError && (
                                <p className="chats-delete-modal__error" role="alert">
                                    {deleteConversationError}
                                </p>
                            )}
                        </div>
                        <footer className="chats-delete-modal__actions">
                            <button
                                ref={deleteCancelButtonRef}
                                type="button"
                                onClick={cancelConversationDeletion}
                                disabled={busy}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="is-destructive"
                                onClick={() => void confirmConversationDeletion()}
                                disabled={busy}
                            >
                                {busy ? "Deleting..." : "Delete permanently"}
                            </button>
                        </footer>
                    </section>
                </div>
            )}
        </div>
    );
}
