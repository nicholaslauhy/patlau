"use client";

import { FormEvent, useEffect, useState } from "react";
import { authenticatedFetch } from "../lib/authenticated-fetch";

interface TelegramSupportAdmin {
    id: string;
    display_name: string;
    active: boolean;
    chat_id_hint: string;
    deployment_fallback: boolean;
    created_at: string | null;
    updated_at: string | null;
}

interface FallbackStatus {
    configured: boolean;
    represented: boolean;
    chat_id_hint: string | null;
}

interface Notice {
    type: "success" | "error";
    text: string;
    leaving?: boolean;
}

const EMPTY_FALLBACK: FallbackStatus = {
    configured: false,
    represented: false,
    chat_id_hint: null,
};

export default function TelegramSupportAdminsManager() {
    const [admins, setAdmins] = useState<TelegramSupportAdmin[]>([]);
    const [fallback, setFallback] = useState<FallbackStatus>(EMPTY_FALLBACK);
    const [effectiveActiveCount, setEffectiveActiveCount] = useState(0);
    const [displayName, setDisplayName] = useState("");
    const [chatId, setChatId] = useState("");
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);

    const showNotice = (type: Notice["type"], text: string) => {
        setNotice({ type, text });
    };

    const dismissNotice = () => {
        setNotice((current) => current ? { ...current, leaving: true } : null);
    };

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => {
            if (notice.leaving) {
                setNotice(null);
            } else {
                setNotice((current) => current ? { ...current, leaving: true } : null);
            }
        }, notice.leaving ? 450 : 9_500);
        return () => window.clearTimeout(timer);
    }, [notice]);

    const loadAdmins = async (showSpinner = true, reportFailure = true) => {
        if (showSpinner) setLoading(true);
        try {
            const response = await authenticatedFetch("/api/telegram-support-admins", {
                method: "GET",
                cache: "no-store",
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || "Could not load Telegram administrators.");
            setAdmins(Array.isArray(data.admins) ? data.admins : []);
            setFallback(data.fallback || EMPTY_FALLBACK);
            setEffectiveActiveCount(Number(data.effective_active_count || 0));
            setLoadFailed(false);
            return true;
        } catch (error) {
            setLoadFailed(true);
            if (reportFailure) {
                showNotice("error", error instanceof Error ? error.message : "Could not load Telegram administrators.");
            }
            return false;
        } finally {
            if (showSpinner) setLoading(false);
        }
    };

    useEffect(() => {
        void loadAdmins();
    }, []);

    const refreshAfterChange = async (successMessage: string) => {
        const refreshed = await loadAdmins(false, false);
        if (refreshed) {
            showNotice("success", successMessage);
        } else {
            showNotice("error", "The change was saved, but the administrator list could not refresh. Use Try again before making another change.");
        }
    };

    const addAdmin = async (event: FormEvent) => {
        event.preventDefault();
        setSubmitting(true);
        try {
            const response = await authenticatedFetch("/api/telegram-support-admins", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    display_name: displayName,
                    telegram_chat_id: chatId,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || "Could not add the Telegram administrator.");
            setDisplayName("");
            setChatId("");
            await refreshAfterChange("Telegram support administrator added. Ask them to send /start to the bot, then send a test.");
        } catch (error) {
            showNotice("error", error instanceof Error ? error.message : "Could not add the Telegram administrator.");
        } finally {
            setSubmitting(false);
        }
    };

    const setAdminActive = async (admin: TelegramSupportAdmin, active: boolean) => {
        setBusyId(admin.id);
        try {
            const response = await authenticatedFetch("/api/telegram-support-admins", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: admin.id, active }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || "Could not update the Telegram administrator.");
            await refreshAfterChange(`${admin.display_name} is now ${active ? "receiving" : "paused from"} support notifications.`);
        } catch (error) {
            showNotice("error", error instanceof Error ? error.message : "Could not update the Telegram administrator.");
        } finally {
            setBusyId(null);
        }
    };

    const testAdmin = async (admin: TelegramSupportAdmin) => {
        setBusyId(admin.id);
        try {
            const response = await authenticatedFetch("/api/telegram-support-admins/test", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: admin.id }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || "Telegram could not deliver the test.");
            showNotice("success", `Test notification sent to ${admin.display_name}.`);
        } catch (error) {
            showNotice("error", error instanceof Error ? error.message : "Telegram could not deliver the test.");
        } finally {
            setBusyId(null);
        }
    };

    const removeAdmin = async (admin: TelegramSupportAdmin) => {
        if (!window.confirm(`Remove ${admin.display_name} from Telegram support administrators?`)) return;
        setBusyId(admin.id);
        try {
            const response = await authenticatedFetch("/api/telegram-support-admins", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: admin.id }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || "Could not remove the Telegram administrator.");
            await refreshAfterChange(`${admin.display_name} was removed from Telegram support administrators.`);
        } catch (error) {
            showNotice("error", error instanceof Error ? error.message : "Could not remove the Telegram administrator.");
        } finally {
            setBusyId(null);
        }
    };

    const interactionBusy = loading || loadFailed || submitting || busyId !== null;

    return (
        <section className="settings-card telegram-admin-card">
            <div className="settings-section-heading telegram-admin-heading">
                <div>
                    <span className="settings-eyebrow">Telegram parent support</span>
                    <h2>Support notification administrators</h2>
                    <p>
                        Choose the trusted Telegram accounts that receive parent escalations and are recognised by the support bot.
                    </p>
                </div>
                <span className={`settings-count${!loading && !loadFailed && effectiveActiveCount === 0 ? " is-warning" : ""}`}>
                    {loading
                        ? "Loading recipients..."
                        : loadFailed
                            ? "Recipients unavailable"
                            : `${effectiveActiveCount} active ${effectiveActiveCount === 1 ? "recipient" : "recipients"}`}
                </span>
            </div>

            {notice && (
                <div
                    className={`telegram-admin-notice is-${notice.type}${notice.leaving ? " is-leaving" : ""}`}
                    role={notice.type === "error" ? "alert" : "status"}
                >
                    <span>{notice.text}</span>
                    <button type="button" onClick={dismissNotice} aria-label="Dismiss notification">&times;</button>
                </div>
            )}

            {effectiveActiveCount === 0 && !loading && !loadFailed && (
                <div className="telegram-admin-zero-warning" role="alert">
                    <strong>No Telegram alert recipient is active.</strong>
                    Parent conversations can still be viewed on the website, but nobody will receive an escalation notification until an administrator is enabled.
                </div>
            )}

            <div className="telegram-admin-guide">
                <strong>Before adding someone</strong>
                <ol>
                    <li>Ask them to open your PatLau parent-support bot and send <code>/myid</code>.</li>
                    <li>Enter the private user ID returned by the bot below.</li>
                    <li>After saving, ask them to send <code>/start</code>, then use <strong>Send test</strong>.</li>
                </ol>
                <p>This grants Telegram alerts only. Website access to <code>/chats</code> still requires a separate Superuser account.</p>
            </div>

            <form className="telegram-admin-form" onSubmit={addAdmin}>
                <div className="form-group">
                    <label htmlFor="telegram-support-admin-name">Display name</label>
                    <input
                        id="telegram-support-admin-name"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        maxLength={80}
                        placeholder="e.g. Coach Patrick"
                        disabled={interactionBusy}
                        required
                    />
                </div>
                <div className="form-group">
                    <label htmlFor="telegram-support-admin-chat-id">Telegram user ID</label>
                    <input
                        id="telegram-support-admin-chat-id"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={chatId}
                        onChange={(event) => setChatId(event.target.value)}
                        minLength={5}
                        maxLength={20}
                        pattern="[0-9]{5,20}"
                        placeholder="Private numeric ID from /myid"
                        disabled={interactionBusy}
                        required
                    />
                </div>
                <button type="submit" className="submit-btn" disabled={interactionBusy}>
                    {submitting ? "Adding..." : "Add administrator"}
                </button>
            </form>

            {fallback.configured && !fallback.represented && (
                <div className="telegram-admin-fallback">
                    <div>
                        <strong>Primary administrator</strong>
                        <span>{fallback.chat_id_hint} remains active from your Vercel environment.</span>
                    </div>
                    <span className="telegram-admin-status is-active">Active</span>
                </div>
            )}

            <div className="telegram-admin-list" aria-live="polite">
                {loading ? (
                    <div className="telegram-admin-empty">Loading Telegram administrators...</div>
                ) : loadFailed ? (
                    <div className="telegram-admin-empty is-error">
                        <strong>Could not load Telegram administrators.</strong>
                        <span>No administrator changes are available until the list is refreshed.</span>
                        <button type="button" className="telegram-admin-button" onClick={() => void loadAdmins()}>
                            Try again
                        </button>
                    </div>
                ) : admins.length === 0 ? (
                    <div className="telegram-admin-empty">
                        No database-managed administrators yet. Add one above to share escalation notifications.
                    </div>
                ) : admins.map((admin) => {
                    const busy = busyId === admin.id;
                    const fallbackHelpId = `telegram-admin-fallback-help-${admin.id}`;
                    return (
                        <article className="telegram-admin-row" key={admin.id}>
                            <div className="telegram-admin-identity">
                                <span className="telegram-admin-avatar" aria-hidden="true">
                                    {admin.display_name.trim().charAt(0).toUpperCase() || "T"}
                                </span>
                                <div>
                                    <strong>{admin.display_name}</strong>
                                    <span className="telegram-admin-id">{admin.chat_id_hint}</span>
                                </div>
                            </div>
                            <div className="telegram-admin-badges">
                                <span className={`telegram-admin-status ${admin.active ? "is-active" : "is-paused"}`}>
                                    {admin.active ? "Active" : "Paused"}
                                </span>
                                {admin.deployment_fallback && (
                                    <span className="telegram-admin-status is-fallback">Primary</span>
                                )}
                            </div>
                            <div className="telegram-admin-actions">
                                <button
                                    type="button"
                                    className="telegram-admin-button"
                                    onClick={() => void testAdmin(admin)}
                                    disabled={interactionBusy || !admin.active}
                                >
                                    {busy ? "Working..." : "Send test"}
                                </button>
                                <button
                                    type="button"
                                    className="telegram-admin-button"
                                    onClick={() => void setAdminActive(admin, !admin.active)}
                                    disabled={interactionBusy || admin.deployment_fallback}
                                    aria-describedby={admin.deployment_fallback ? fallbackHelpId : undefined}
                                >
                                    {admin.active ? "Pause alerts" : "Enable alerts"}
                                </button>
                                <button
                                    type="button"
                                    className="telegram-admin-button is-destructive"
                                    onClick={() => void removeAdmin(admin)}
                                    disabled={interactionBusy || admin.deployment_fallback}
                                    aria-describedby={admin.deployment_fallback ? fallbackHelpId : undefined}
                                >
                                    Remove
                                </button>
                                {admin.deployment_fallback && (
                                    <span id={fallbackHelpId} className="telegram-admin-action-help">
                                        The primary administrator is configured in Vercel. Remove that fallback variable before pausing or deleting this account.
                                    </span>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
