"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    human_active: "Human active",
    resolved: "Resolved",
    closed_parent: "Closed by parent",
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

export default function ChatsPage() {
    const router = useRouter();
    const messageEndRef = useRef<HTMLDivElement>(null);
    const [userName, setUserName] = useState("");
    const [authorized, setAuthorized] = useState(false);
    const [tab, setTab] = useState<ChatsTab>("inbox");
    const [conversations, setConversations] = useState<SupportConversation[]>([]);
    const [knowledge, setKnowledge] = useState<SupportKnowledge[]>([]);
    const [announcements, setAnnouncements] = useState<SupportAnnouncement[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [selectedConversation, setSelectedConversation] = useState<SupportConversation | null>(null);
    const [messages, setMessages] = useState<SupportMessage[]>([]);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [reply, setReply] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

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
        priority: 50,
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
        if (!response.ok) throw new Error(data.error || "Support request failed.");
        return data;
    }, [token]);

    const loadSummary = useCallback(async (showLoader = false) => {
        if (showLoader) setLoading(true);
        try {
            const data = await supportFetch("/api/support");
            setConversations(data.conversations || []);
            setKnowledge(data.knowledge || []);
            setAnnouncements(data.announcements || []);
            setError("");

            if (!selectedId && data.conversations?.length) {
                const requestedId = new URLSearchParams(window.location.search).get("conversation");
                const nextId = data.conversations.some((item: SupportConversation) => item.id === requestedId)
                    ? requestedId
                    : data.conversations[0].id;
                setSelectedId(nextId || "");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not load Chats.");
        } finally {
            if (showLoader) setLoading(false);
        }
    }, [selectedId, supportFetch]);

    const loadConversation = useCallback(async (conversationId: string) => {
        if (!conversationId) return;
        try {
            const data = await supportFetch(`/api/support?conversation_id=${encodeURIComponent(conversationId)}`);
            setSelectedConversation(data.conversation);
            setMessages(data.messages || []);
            setConversations((previous) => previous.map((item) =>
                item.id === conversationId ? { ...item, ...data.conversation, unread_count: 0 } : item,
            ));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not load the conversation.");
        }
    }, [supportFetch]);

    useEffect(() => {
        const initialise = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                router.push("/");
                return;
            }
            const role = user.app_metadata?.role || user.user_metadata?.role || "member";
            if (role !== "superuser") {
                router.push("/dashboard");
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
        if (selectedId) void loadConversation(selectedId);
    }, [loadConversation, selectedId]);

    useEffect(() => {
        if (!authorized) return;
        const interval = window.setInterval(() => {
            void loadSummary(false);
            if (selectedId && tab === "inbox") void loadConversation(selectedId);
        }, 10000);
        return () => window.clearInterval(interval);
    }, [authorized, loadConversation, loadSummary, selectedId, tab]);

    useEffect(() => {
        messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [messages]);

    const runAction = async (payload: Record<string, unknown>, message?: string) => {
        setBusy(true);
        setError("");
        setSuccess("");
        try {
            await supportFetch("/api/support", { method: "POST", body: JSON.stringify(payload) });
            if (message) setSuccess(message);
            await loadSummary(false);
            if (selectedId) await loadConversation(selectedId);
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
        if (!content || !selectedId) return;
        const sent = await runAction({ action: "send_message", conversationId: selectedId, content });
        if (sent) setReply("");
    };

    const changeStatus = (status: SupportStatus, reason: string) =>
        runAction({ action: "set_status", conversationId: selectedId, status, reason }, `Conversation marked ${statusLabels[status].toLowerCase()}.`);

    const resetKnowledgeForm = () => setKnowledgeForm({ id: "", title: "", category: "General", content: "", status: "draft" });
    const saveKnowledge = async (event: React.FormEvent) => {
        event.preventDefault();
        const saved = await runAction({ action: "save_knowledge", ...knowledgeForm }, knowledgeForm.id ? "Knowledge updated." : "Knowledge added.");
        if (saved) resetKnowledgeForm();
    };

    const resetAnnouncementForm = () => setAnnouncementForm({
        id: "", title: "", content: "", programme: "all", startsOn: todayKey(), endsOn: todayKey(), priority: 50, status: "draft",
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

    const counts = useMemo(() => ({
        escalated: conversations.filter((item) => item.status === "escalated").length,
        human: conversations.filter((item) => item.status === "human_active").length,
        unread: conversations.reduce((sum, item) => sum + Number(item.unread_count || 0), 0),
    }), [conversations]);

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
                        <div><strong>{counts.human}</strong><span>Human active</span></div>
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

                {error && <div className="error-message chats-message" role="alert">{error}</div>}
                {success && <div className="success-message chats-message" role="status">{success}</div>}

                {tab === "inbox" && (
                    <section className="chats-inbox">
                        <aside className="chats-conversation-list">
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
                                        onClick={() => setSelectedId(conversation.id)}
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
                            {!selectedConversation ? (
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
                                    <div className="chats-thread-actions">
                                        {selectedConversation.status !== "human_active" && (
                                            <button type="button" onClick={() => void changeStatus("human_active", "Superuser took over the conversation.")} disabled={busy}>Take over</button>
                                        )}
                                        {selectedConversation.status !== "ai_active" && selectedConversation.status !== "waiting_parent" && (
                                            <button type="button" onClick={() => void changeStatus("ai_active", "Returned to AI by superuser.")} disabled={busy}>Return to AI</button>
                                        )}
                                        {selectedConversation.status !== "resolved" && (
                                            <button type="button" onClick={() => void changeStatus("resolved", "Resolved by superuser.")} disabled={busy}>Resolve</button>
                                        )}
                                    </div>
                                    <div className="chats-messages" aria-live="polite">
                                        {messages.map((message) => (
                                            <article key={message.id} className={`chats-bubble chats-bubble--${message.sender_type}`}>
                                                <div className="chats-bubble-meta">
                                                    <strong>{message.sender_type === "parent" ? contactName(selectedConversation) : message.sender_type === "superuser" ? "You" : message.sender_type === "ai" ? "AI assistant" : "System"}</strong>
                                                    <time>{formatTime(message.created_at)}</time>
                                                </div>
                                                <p>{message.content}</p>
                                                {message.source_refs?.length > 0 && <small>Sources: {message.source_refs.join(", ")}</small>}
                                            </article>
                                        ))}
                                        <div ref={messageEndRef} />
                                    </div>
                                    <form className="chats-reply" onSubmit={sendReply}>
                                        <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to this parent through Telegram…" rows={3} maxLength={3900} disabled={busy || selectedConversation.contact?.blocked} />
                                        <div>
                                            <span>{selectedConversation.status === "human_active" ? "AI is paused while you handle this chat." : "Sending a reply will automatically take over this chat."}</span>
                                            <button type="submit" className="submit-btn" disabled={busy || !reply.trim() || selectedConversation.contact?.blocked}>{busy ? "Sending…" : "Send reply"}</button>
                                        </div>
                                    </form>
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
                            {knowledge.length === 0 ? <p className="chats-empty-card">No knowledge has been added. The chatbot will escalate rather than guess.</p> : knowledge.map((item) => (
                                <article key={item.id} className="chats-record-card">
                                    <div><span className={`chats-record-status is-${item.status}`}>{item.status}</span><small>{item.category}</small></div>
                                    <h3>{item.title}</h3><p>{item.content}</p><time>Updated {formatTime(item.updated_at)}</time>
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
                            <div className="chats-date-grid"><label>Priority<input type="number" min="0" max="100" value={announcementForm.priority} onChange={(event) => setAnnouncementForm((form) => ({ ...form, priority: Number(event.target.value) }))} /></label><label>Status<select value={announcementForm.status} onChange={(event) => setAnnouncementForm((form) => ({ ...form, status: event.target.value as SupportAnnouncement["status"] }))}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label></div>
                            <div className="chats-form-actions">{announcementForm.id && <button type="button" className="cancel-btn" onClick={resetAnnouncementForm}>Cancel edit</button>}<button type="submit" className="submit-btn" disabled={busy}>{busy ? "Saving…" : "Save announcement"}</button></div>
                        </form>
                        <div className="chats-record-list">
                            {announcements.length === 0 ? <p className="chats-empty-card">No announcements yet. Add dated holiday or operational information here.</p> : announcements.map((item) => (
                                <article key={item.id} className="chats-record-card">
                                    <div><span className={`chats-record-status is-${item.status}`}>{item.status}</span><small>{item.programme} · Priority {item.priority}</small></div>
                                    <h3>{item.title}</h3><p>{item.content}</p><time>{item.starts_on} to {item.ends_on} · Updated {formatTime(item.updated_at)}</time>
                                    <div className="chats-record-actions"><button type="button" onClick={() => setAnnouncementForm({ id: item.id, title: item.title, content: item.content, programme: item.programme, startsOn: item.starts_on, endsOn: item.ends_on, priority: item.priority, status: item.status })}>Edit</button><button type="button" className="is-destructive" onClick={() => confirm(`Delete “${item.title}”?`) && void runAction({ action: "delete_announcement", id: item.id }, "Announcement deleted.")}>Delete</button></div>
                                </article>
                            ))}
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}
