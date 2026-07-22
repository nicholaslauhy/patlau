"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import AppHeader from "./../components/AppHeader";
import PasswordField from "./../components/PasswordField";
import ProfilePhotoEditor from "./../components/ProfilePhotoEditor";
import ProfileCameraCapture from "./../components/ProfileCameraCapture";
import TelegramSupportAdminsManager from "./../components/TelegramSupportAdminsManager";
import { authenticatedFetch } from "./../lib/authenticated-fetch";
import "./../styles.css";
import "./../dashboard/dashboard.css";
import "./settings.css";

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type UserRole = "superuser" | "admin" | "member";

interface User {
    id: string;
    email: string;
    user_metadata?: {
        name?: string;
        role?: UserRole;
        avatar_url?: string | null;
        avatar_path?: string | null;
    };
    app_metadata?: {
        role?: UserRole;
    };
}

interface CoachProfile {
    auth_user_id: string;
    telegram_handle: string | null;
}

const normalizeHandle = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return "";
    return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
};

export default function SettingsPage() {
    const router = useRouter();
    const [userName, setUserName] = useState("");
    const [userRole, setUserRole] = useState<UserRole>("member");
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [currentUserId, setCurrentUserId] = useState("");
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
    const [photoBusy, setPhotoBusy] = useState(false);
    const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [photoError, setPhotoError] = useState("");
    const [photoSuccess, setPhotoSuccess] = useState("");
    const photoEditorRef = useRef<HTMLDivElement>(null);
    const photoFileRef = useRef<HTMLInputElement>(null);
    const [profileHandles, setProfileHandles] = useState<Record<string, string>>(
        {},
    );

    // Form state
    const [newUserEmail, setNewUserEmail] = useState("");
    const [newUserName, setNewUserName] = useState("");
    const [newUserPassword, setNewUserPassword] = useState("");
    const [newUserRole, setNewUserRole] = useState<UserRole>("member");
    const [newUserTelegramHandle, setNewUserTelegramHandle] = useState("");

    useEffect(() => {
        loadUserInfo();
        loadUsers();
        loadCoachProfiles();
    }, []);

    useEffect(() => {
        const dismiss = (event: PointerEvent) => {
            if (!photoEditorRef.current?.contains(event.target as Node)) {
                setPhotoMenuOpen(false);
            }
        };
        document.addEventListener("pointerdown", dismiss);
        return () => document.removeEventListener("pointerdown", dismiss);
    }, []);

    const loadUserInfo = async () => {
        try {
            const {
                data: { user },
            } = await supabase.auth.getUser();
            if (user) {
                setCurrentUserId(user.id);
                setUserName(user.user_metadata?.name || user.email || "User");
                setUserRole(
                    (user.app_metadata?.role as UserRole)
                    || (user.user_metadata?.role as UserRole)
                    || "member",
                );
                setAvatarUrl(user.user_metadata?.avatar_url || null);
            } else {
                router.push("/");
            }
        } catch (err) {
            console.error("Failed to load user info:", err);
            router.push("/");
        }
    };

    const announceAvatar = (nextAvatarUrl: string | null) => {
        window.dispatchEvent(
            new CustomEvent("avatar-updated", {
                detail: { avatarUrl: nextAvatarUrl },
            }),
        );
    };

    const handlePhotoSelected = (file?: File) => {
        if (!file) return;

        setPhotoError("");
        setPhotoSuccess("");
        setPhotoMenuOpen(false);

        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            setPhotoError("Choose a JPG, PNG, or WebP image.");
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setPhotoError("Profile photos must be 5 MB or smaller.");
            return;
        }

        setPendingPhoto(file);
        if (photoFileRef.current) photoFileRef.current.value = "";
    };

    const uploadCroppedPhoto = async (blob: Blob) => {
        try {
            setPhotoBusy(true);
            setPhotoError("");
            const {
                data: { session },
            } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("Please sign in again to update your photo.");

            const formData = new FormData();
            formData.append("photo", new File([blob], "profile-photo.jpg", { type: "image/jpeg" }));
            const response = await fetch("/api/profile/photo", {
                method: "POST",
                headers: { Authorization: `Bearer ${session.access_token}` },
                body: formData,
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Failed to update profile photo");

            setAvatarUrl(data.avatarUrl);
            announceAvatar(data.avatarUrl);
            setUsers((previous) =>
                previous.map((managedUser) =>
                    managedUser.id === currentUserId
                        ? {
                            ...managedUser,
                            user_metadata: {
                                ...(managedUser.user_metadata || {}),
                                avatar_url: data.avatarUrl,
                            },
                        }
                        : managedUser,
                ),
            );
            setPhotoSuccess("Profile photo updated.");
            setPendingPhoto(null);
        } catch (err) {
            setPhotoError(err instanceof Error ? err.message : "Failed to update profile photo");
        } finally {
            setPhotoBusy(false);
        }
    };

    const handleRemovePhoto = async () => {
        setPhotoError("");
        setPhotoSuccess("");
        setPhotoMenuOpen(false);

        try {
            setPhotoBusy(true);
            const {
                data: { session },
            } = await supabase.auth.getSession();
            if (!session?.access_token) throw new Error("Please sign in again to remove your photo.");

            const response = await fetch("/api/profile/photo", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${session.access_token}` },
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Failed to remove profile photo");

            setAvatarUrl(null);
            announceAvatar(null);
            setUsers((previous) =>
                previous.map((managedUser) =>
                    managedUser.id === currentUserId
                        ? {
                            ...managedUser,
                            user_metadata: {
                                ...(managedUser.user_metadata || {}),
                                avatar_url: null,
                                avatar_path: null,
                            },
                        }
                        : managedUser,
                ),
            );
            setPhotoSuccess("Profile photo removed.");
        } catch (err) {
            setPhotoError(err instanceof Error ? err.message : "Failed to remove profile photo");
        } finally {
            setPhotoBusy(false);
        }
    };

    const loadUsers = async () => {
        try {
            setIsLoading(true);
            const response = await authenticatedFetch("/api/users/list", {
                method: "GET",
                headers: { "Content-Type": "application/json" },
            });

            if (response.ok) {
                const data = await response.json();
                setUsers(data.users || []);
            }
        } catch (err) {
            console.error("Failed to load users:", err);
        } finally {
            setIsLoading(false);
        }
    };

    const loadCoachProfiles = async () => {
        try {
            const { data, error } = await supabase
                .from("coach_profiles")
                .select("auth_user_id, telegram_handle");

            if (error) throw error;

            const nextHandles: Record<string, string> = {};
            ((data || []) as CoachProfile[]).forEach((profile) => {
                nextHandles[profile.auth_user_id] = normalizeHandle(
                    profile.telegram_handle || "",
                );
            });

            setProfileHandles(nextHandles);
        } catch (err) {
            console.error("Failed to load Telegram handles:", err);
        }
    };

    const saveTelegramHandle = async (
        targetUserId: string,
        targetName: string,
    ) => {
        setError("");
        setSuccess("");

        const normalized = normalizeHandle(profileHandles[targetUserId] || "");

        if (!normalized) {
            setError("Telegram handle cannot be empty. Use @username format.");
            return;
        }

        try {
            setIsLoading(true);

            const { error } = await supabase.from("coach_profiles").upsert(
                {
                    auth_user_id: targetUserId,
                    telegram_handle: normalized,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: "auth_user_id" },
            );

            if (error) throw error;

            setProfileHandles((prev) => ({ ...prev, [targetUserId]: normalized }));
            setSuccess(`Telegram handle linked for ${targetName}.`);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Failed to save Telegram handle",
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setSuccess("");

        if (!newUserEmail || !newUserName) {
            setError("Email and name are required");
            return;
        }

        // Client-side validation
        const normalizedEmail = newUserEmail.toLowerCase().trim();
        const normalizedName = newUserName.trim();
        const normalizedTelegramHandle = normalizeHandle(newUserTelegramHandle);

        // Check if email or username already exists in the current user list
        const emailExists = users.some(
            (u) => u.email?.toLowerCase() === normalizedEmail,
        );
        if (emailExists) {
            setError(`Email "${normalizedEmail}" is already in use`);
            return;
        }

        const usernameExists = users.some(
            (u) =>
                u.user_metadata?.name?.toLowerCase() === normalizedName.toLowerCase(),
        );
        if (usernameExists) {
            setError(
                `Username "${normalizedName}" is already taken. Please try another username!`,
            );
            return;
        }

        try {
            setIsLoading(true);

            // If current user is admin, force role to 'member' to prevent creating privileged accounts
            const roleToSend = userRole === "admin" ? "member" : newUserRole;

            const response = await authenticatedFetch("/api/users/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: normalizedEmail,
                    name: normalizedName,
                    role: roleToSend,
                    password: newUserPassword || undefined,
                    telegramHandle: normalizedTelegramHandle || undefined,
                    telegram_handle: normalizedTelegramHandle || undefined,
                }),
            });

            const responseData = await response.json();

            if (!response.ok) {
                // Check for conflict errors (409 = duplicate email/username)
                if (response.status === 409) {
                    setError(responseData.error || "User already exists");
                } else {
                    setError(responseData.error || "Failed to create user");
                }
                return;
            }

            const createdUserId =
                responseData?.user?.id || responseData?.id || responseData?.userId;

            if (createdUserId && normalizedTelegramHandle) {
                const { error: profileError } = await supabase
                    .from("coach_profiles")
                    .upsert(
                        {
                            auth_user_id: createdUserId,
                            telegram_handle: normalizedTelegramHandle,
                            updated_at: new Date().toISOString(),
                        },
                        { onConflict: "auth_user_id" },
                    );

                if (profileError) {
                    throw new Error(
                        `User created, but Telegram handle was not linked: ${profileError.message}`,
                    );
                }
            }

            setSuccess(
                `User ${normalizedName} created successfully${normalizedTelegramHandle ? ` and linked to ${normalizedTelegramHandle}` : ""}`,
            );
            setNewUserEmail("");
            setNewUserName("");
            setNewUserPassword("");
            setNewUserRole("member");
            setNewUserTelegramHandle("");

            // Reload users list
            await loadUsers();
            await loadCoachProfiles();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to create user");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteUser = async (
        userId: string,
        email: string,
        targetRole?: UserRole,
    ) => {
        if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;

        // Frontend protection: admins are allowed to delete only 'member' accounts.
        if (userRole === "admin" && targetRole && targetRole !== "member") {
            setError("Admins can only delete member accounts.");
            return;
        }

        try {
            const response = await authenticatedFetch(`/api/users/delete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId }),
            });

            if (!response.ok) {
                throw new Error("Failed to delete user");
            }

            setSuccess("User deleted successfully");
            await loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to delete user");
        }
    };

    // call server to update a user's role (superuser only)
    const updateUserRole = async (userId: string, newRole: UserRole) => {
        setError("");
        setSuccess("");
        setIsLoading(true);
        try {
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const token = session?.access_token;

            if (!token) {
                setError("No session found. Please log in again.");
                setIsLoading(false);
                return;
            }

            const response = await authenticatedFetch("/api/users/update", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ userId, role: newRole }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => null);
                throw new Error(err?.error || "Failed to update user role");
            }

            setSuccess("User role updated");
            setError(""); // explicitly clear error on success
            setUsers((prev) =>
                prev.map((u) =>
                    u.id === userId
                        ? {
                            ...u,
                            user_metadata: { ...(u.user_metadata || {}), role: newRole },
                        }
                        : u,
                ),
            );
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Failed to update user role",
            );
            setSuccess("");
        } finally {
            setIsLoading(false);
        }
    };

    const handleResendResetCode = async (
        targetEmail: string,
        targetRole?: UserRole,
    ) => {
        setError("");
        setSuccess("");

        // Admins can only send reset codes to members
        if (userRole === "admin" && targetRole !== "member") {
            setError("Admins can only resend reset codes to member accounts.");
            return;
        }

        try {
            setIsLoading(true);

            const {
                data: { session },
            } = await supabase.auth.getSession();
            const token = session?.access_token;

            if (!token) {
                setError("No session found. Please log in again.");
                return;
            }

            const response = await authenticatedFetch("/api/users/resend-reset-code", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    email: targetEmail,
                }),
            });

            const text = await response.text();

            let data: { error?: string; message?: string } = {};
            try {
                data = text ? JSON.parse(text) : {};
            } catch {
                console.error("Non-JSON response from resend-reset-code:", text);
                throw new Error(
                    "Server returned HTML instead of JSON. Check that /api/users/resend-reset-code/route.ts exists.",
                );
            }

            if (!response.ok) {
                throw new Error(data.error || "Failed to resend reset code");
            }

            setSuccess(`Reset code sent to ${targetEmail}`);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Failed to resend reset code",
            );
        } finally {
            setIsLoading(false);
        }
    };

    // Determine which users to show to the current viewer:
    // - superusers see everyone
    // - admins see only members
    // - members see only themselves
    const visibleUsers =
        userRole === "superuser"
            ? users
            : userRole === "admin"
                ? users.filter((u) => (u.user_metadata?.role || "member") === "member")
                : users.filter((u) => u.id === currentUserId);

    return (
        <div className="container">
            <AppHeader
                title="Settings"
                userName={userName}
                userRole={userRole}
                mode="dashboard"
            />

            <main>
                <div className="settings-container">
                    {/* Current User Info */}
                    <section className="settings-card settings-account-card">
                        <div className="settings-account-summary">
                            <div className="settings-avatar-editor" ref={photoEditorRef}>
                                <button
                                    type="button"
                                    className="settings-account-avatar settings-avatar-button"
                                    onClick={() => setPhotoMenuOpen((open) => !open)}
                                    disabled={photoBusy}
                                    aria-haspopup="menu"
                                    aria-expanded={photoMenuOpen}
                                    aria-label={avatarUrl ? "Change profile photo" : "Add profile photo"}
                                    title={avatarUrl ? "Change profile photo" : "Add profile photo"}
                                >
                                    {avatarUrl ? (
                                        <img src={avatarUrl} alt="" onError={() => setAvatarUrl(null)} />
                                    ) : (
                                        (userName || "U").trim().charAt(0).toUpperCase()
                                    )}
                                    <span className="settings-avatar-camera" aria-hidden="true">+</span>
                                </button>

                                {photoMenuOpen && (
                                    <div className="settings-photo-menu" role="menu" aria-label="Profile photo options">
                                        <button type="button" role="menuitem" onClick={() => photoFileRef.current?.click()}>
                                            <span>Choose photo</span>
                                            <small>JPG, PNG or WebP</small>
                                        </button>
                                        <button type="button" role="menuitem" onClick={() => {
                                            setPhotoMenuOpen(false);
                                            setCameraOpen(true);
                                        }}>
                                            <span>Take photo</span>
                                            <small>Use this device&apos;s camera</small>
                                        </button>
                                        {avatarUrl && (
                                            <button type="button" role="menuitem" className="is-destructive" onClick={handleRemovePhoto}>
                                                <span>Remove photo</span>
                                                <small>Restore the default icon</small>
                                            </button>
                                        )}
                                    </div>
                                )}

                                <input
                                    ref={photoFileRef}
                                    className="settings-photo-input"
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    onChange={(event) => void handlePhotoSelected(event.target.files?.[0])}
                                    tabIndex={-1}
                                />
                            </div>
                            <div>
                                <span className="settings-eyebrow">Signed in account</span>
                                <h1>{userName || "User"}</h1>
                                <div className="settings-account-meta">
                                    <span className={`role-badge ${userRole}`}>
                                        {userRole.toUpperCase()}
                                    </span>
                                    <span>Manage your account access and application users.</span>
                                </div>
                            </div>
                        </div>
                        {photoBusy && <p className="settings-photo-status" role="status">Updating your profile photo…</p>}
                        {photoError && !pendingPhoto && <div className="error-message settings-account-message">{photoError}</div>}
                        {photoSuccess && <div className="success-message settings-account-message">{photoSuccess}</div>}
                    </section>

                    {userRole === "superuser" && <TelegramSupportAdminsManager />}

                    {/* Add New User */}
                    {/* Admins and superusers can add new users. Admins can only create 'member' accounts. */}
                    {(userRole === "superuser" || userRole === "admin") && (
                        <section className="settings-card">
                            <div className="settings-section-heading">
                                <div>
                                    <span className="settings-eyebrow">Account administration</span>
                                    <h2>Add New User</h2>
                                    <p>Create a new login and assign the appropriate access level.</p>
                                </div>
                            </div>

                            {error && <div className="error-message">{error}</div>}
                            {success && <div className="success-message">{success}</div>}

                            <form onSubmit={handleAddUser} className="user-form settings-user-form">
                                <div className="form-group">
                                    <label htmlFor="name">Full Name *</label>
                                    <input
                                        type="text"
                                        id="name"
                                        value={newUserName}
                                        onChange={(e) => setNewUserName(e.target.value)}
                                        placeholder="Enter user's full name"
                                        disabled={isLoading}
                                    />
                                </div>

                                <div className="form-group">
                                    <label htmlFor="email">Email *</label>
                                    <input
                                        type="email"
                                        id="email"
                                        value={newUserEmail}
                                        onChange={(e) => setNewUserEmail(e.target.value)}
                                        placeholder="Enter user's email"
                                        disabled={isLoading}
                                    />
                                </div>

                                <div className="form-group">
                                    <label htmlFor="password">Initial password (optional)</label>
                                    <PasswordField
                                        id="password"
                                        value={newUserPassword}
                                        onChange={(e) => setNewUserPassword(e.target.value)}
                                        placeholder="Temporary password (optional)"
                                        disabled={isLoading}
                                    />
                                </div>

                                <div className="form-group">
                                    <label htmlFor="telegramHandle">Telegram handle</label>
                                    <input
                                        type="text"
                                        id="telegramHandle"
                                        value={newUserTelegramHandle}
                                        onChange={(e) => setNewUserTelegramHandle(e.target.value)}
                                        placeholder="@telegramusername"
                                        disabled={isLoading}
                                    />
                                </div>

                                <div className="form-group">
                                    <label htmlFor="role">Role *</label>

                                    {/* If current user is admin, only show member and disable changing */}
                                    {userRole === "admin" ? (
                                        <select id="role" value={"member"} disabled>
                                            <option value="member">Member</option>
                                        </select>
                                    ) : (
                                        <select
                                            id="role"
                                            value={newUserRole}
                                            onChange={(e) =>
                                                setNewUserRole(e.target.value as UserRole)
                                            }
                                            disabled={isLoading}
                                        >
                                            <option value="member">Member</option>
                                            <option value="admin">Admin</option>
                                            <option value="superuser">Superuser</option>
                                        </select>
                                    )}
                                </div>

                                <button
                                    type="submit"
                                    className="submit-btn"
                                    disabled={isLoading}
                                >
                                    {isLoading ? "Creating User..." : "Add User"}
                                </button>
                            </form>
                        </section>
                    )}

                    {/* Users List (manage) */}
                    {(userRole === "superuser" || userRole === "admin") && (
                        <section className="settings-card">
                            <div className="settings-section-heading">
                                <div>
                                    <span className="settings-eyebrow">User directory</span>
                                    <h2>Manage Users</h2>
                                    <p>Update Telegram handles, roles, passwords, and account access.</p>
                                </div>
                                <span className="settings-count">{visibleUsers.length} users</span>
                            </div>

                            {isLoading ? (
                                <p>Loading users...</p>
                            ) : visibleUsers.length === 0 ? (
                                <p>No users found</p>
                            ) : (
                                <div className="users-table table-container">
                                    <div className="table-scroll">
                                        <table>
                                        <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Email</th>
                                            <th>Telegram</th>
                                            <th>Role</th>
                                            <th>Actions</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {visibleUsers.map((managedUser) => {
                                            const isSelf = managedUser.id === currentUserId;

                                            return (
                                                <tr key={managedUser.id}>
                                                    <td>
                                                        <div className="settings-user-identity">
                                                            <span className="settings-user-thumb" aria-hidden="true">
                                                                {managedUser.user_metadata?.avatar_url ? (
                                                                    <img
                                                                        src={managedUser.user_metadata.avatar_url}
                                                                        alt=""
                                                                        onError={() =>
                                                                            setUsers((previous) =>
                                                                                previous.map((candidate) =>
                                                                                    candidate.id === managedUser.id
                                                                                        ? {
                                                                                            ...candidate,
                                                                                            user_metadata: {
                                                                                                ...(candidate.user_metadata || {}),
                                                                                                avatar_url: null,
                                                                                            },
                                                                                        }
                                                                                        : candidate,
                                                                                ),
                                                                            )
                                                                        }
                                                                    />
                                                                ) : (
                                                                    (managedUser.user_metadata?.name || managedUser.email || "U")
                                                                        .trim()
                                                                        .charAt(0)
                                                                        .toUpperCase()
                                                                )}
                                                            </span>
                                                            <span>{managedUser.user_metadata?.name || "N/A"}</span>
                                                        </div>
                                                    </td>
                                                    <td>{managedUser.email}</td>
                                                    <td>
                                                        <div
                                                            style={{
                                                                display: "flex",
                                                                gap: "8px",
                                                                alignItems: "center",
                                                            }}
                                                        >
                                                            <input
                                                                className="role-select"
                                                                value={profileHandles[managedUser.id] || ""}
                                                                onChange={(e) => {
                                                                    const normalizedValue = e.target.value;
                                                                    setProfileHandles((prev) => ({
                                                                        ...prev,
                                                                        [managedUser.id]: normalizedValue,
                                                                    }));
                                                                }}
                                                                placeholder="@username"
                                                                disabled={isLoading}
                                                                style={{ minWidth: 150 }}
                                                            />
                                                            <button
                                                                type="button"
                                                                className="resend-btn-small"
                                                                onClick={() =>
                                                                    saveTelegramHandle(
                                                                        managedUser.id,
                                                                        managedUser.user_metadata?.name ||
                                                                        managedUser.email,
                                                                    )
                                                                }
                                                                disabled={
                                                                    isLoading || !profileHandles[managedUser.id]
                                                                }
                                                            >
                                                                Save
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {userRole === "superuser" ? (
                                                            <select
                                                                className="role-select"
                                                                value={
                                                                    (managedUser.user_metadata
                                                                        ?.role as UserRole) || "member"
                                                                }
                                                                onChange={async (e) => {
                                                                    const selected = e.target.value as UserRole;
                                                                    setError("");
                                                                    setSuccess("");

                                                                    if (isSelf) {
                                                                        setError(
                                                                            "You cannot change your own role.",
                                                                        );
                                                                        setUsers((prev) => [...prev]);
                                                                        return;
                                                                    }

                                                                    if (
                                                                        managedUser.user_metadata?.role !==
                                                                        selected &&
                                                                        !confirm(
                                                                            `Change role from ${(managedUser.user_metadata?.role || "member").toUpperCase()} to ${selected.toUpperCase()}?`,
                                                                        )
                                                                    ) {
                                                                        setUsers((prev) => [...prev]);
                                                                        return;
                                                                    }

                                                                    await updateUserRole(
                                                                        managedUser.id,
                                                                        selected,
                                                                    );
                                                                }}
                                                                disabled={isLoading || isSelf}
                                                                title={
                                                                    isSelf
                                                                        ? "You cannot change your own role"
                                                                        : undefined
                                                                }
                                                            >
                                                                <option value="member">Member</option>
                                                                <option value="admin">Admin</option>
                                                                <option value="superuser">Superuser</option>
                                                            </select>
                                                        ) : (
                                                            <span
                                                                className={`role-badge ${managedUser.user_metadata?.role || "member"}`}
                                                            >
                                  {(
                                      managedUser.user_metadata?.role || "member"
                                  ).toUpperCase()}
                                </span>
                                                        )}
                                                    </td>

                                                    <td>
                                                        {userRole === "superuser" ? (
                                                            <div style={{ display: "flex", gap: "8px" }}>
                                                                <button
                                                                    onClick={() =>
                                                                        handleResendResetCode(
                                                                            managedUser.email,
                                                                            managedUser.user_metadata
                                                                                ?.role as UserRole,
                                                                        )
                                                                    }
                                                                    className="resend-btn-small"
                                                                    disabled={isLoading}
                                                                >
                                                                    Reset Password
                                                                </button>

                                                                <button
                                                                    onClick={() =>
                                                                        handleDeleteUser(
                                                                            managedUser.id,
                                                                            managedUser.email,
                                                                            managedUser.user_metadata
                                                                                ?.role as UserRole,
                                                                        )
                                                                    }
                                                                    className="delete-btn-small"
                                                                    disabled={isLoading || isSelf}
                                                                    title={
                                                                        isSelf
                                                                            ? "You cannot delete your own account"
                                                                            : undefined
                                                                    }
                                                                >
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: "flex", gap: "8px" }}>
                                                                <button
                                                                    onClick={() =>
                                                                        handleResendResetCode(
                                                                            managedUser.email,
                                                                            managedUser.user_metadata
                                                                                ?.role as UserRole,
                                                                        )
                                                                    }
                                                                    className="resend-btn-small"
                                                                    disabled={
                                                                        isLoading ||
                                                                        managedUser.user_metadata?.role !==
                                                                        "member" ||
                                                                        isSelf
                                                                    }
                                                                    style={{ background: "#2563eb" }}
                                                                    title={
                                                                        isSelf
                                                                            ? "You cannot resend reset code to yourself"
                                                                            : managedUser.user_metadata?.role !==
                                                                            "member"
                                                                                ? "Admins can only resend reset codes to member accounts"
                                                                                : undefined
                                                                    }
                                                                >
                                                                    Reset Password
                                                                </button>

                                                                <button
                                                                    onClick={() =>
                                                                        handleDeleteUser(
                                                                            managedUser.id,
                                                                            managedUser.email,
                                                                            managedUser.user_metadata
                                                                                ?.role as UserRole,
                                                                        )
                                                                    }
                                                                    className="delete-btn-small"
                                                                    disabled={
                                                                        isLoading ||
                                                                        managedUser.user_metadata?.role !==
                                                                        "member" ||
                                                                        isSelf
                                                                    }
                                                                    title={
                                                                        isSelf
                                                                            ? "You cannot delete your own account"
                                                                            : managedUser.user_metadata?.role !==
                                                                            "member"
                                                                                ? "Admins can only delete member accounts"
                                                                                : undefined
                                                                    }
                                                                >
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </section>
                    )}
                </div>
            </main>
            {pendingPhoto && (
                <ProfilePhotoEditor
                    file={pendingPhoto}
                    saving={photoBusy}
                    error={photoError}
                    onCancel={() => {
                        if (!photoBusy) {
                            setPendingPhoto(null);
                            setPhotoError("");
                        }
                    }}
                    onSave={(blob) => void uploadCroppedPhoto(blob)}
                />
            )}
            {cameraOpen && (
                <ProfileCameraCapture
                    onCancel={() => setCameraOpen(false)}
                    onChoosePhoto={() => {
                        setCameraOpen(false);
                        photoFileRef.current?.click();
                    }}
                    onCapture={(file) => {
                        setCameraOpen(false);
                        handlePhotoSelected(file);
                    }}
                />
            )}
        </div>
    );
}
