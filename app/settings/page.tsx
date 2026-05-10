'use client'

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';
import './../styles.css';
import './../dashboard/dashboard.css';
import './settings.css';

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type UserRole = 'superuser' | 'admin' | 'member';

interface User {
    id: string;
    email: string;
    user_metadata?: {
        name?: string;
        role?: UserRole;
    };
}

export default function SettingsPage() {
    const router = useRouter();
    const [userName, setUserName] = useState('');
    const [userRole, setUserRole] = useState<UserRole>('member');
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [currentUserId, setCurrentUserId] = useState('');

    // Form state
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserName, setNewUserName] = useState('');
    const [newUserPassword, setNewUserPassword] = useState('');
    const [newUserRole, setNewUserRole] = useState<UserRole>('member');

    useEffect(() => {
        loadUserInfo();
        loadUsers();
    }, []);

    const loadUserInfo = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                setCurrentUserId(user.id);
                setUserName(user.user_metadata?.name || user.email || 'User');
                setUserRole((user.user_metadata?.role as UserRole) || 'member');
            } else {
                router.push('/');
            }
        } catch (err) {
            console.error('Failed to load user info:', err);
            router.push('/');
        }
    };

    const loadUsers = async () => {
        try {
            setIsLoading(true);
            const response = await fetch('/api/users/list', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                setUsers(data.users || []);
            }
        } catch (err) {
            console.error('Failed to load users:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (!newUserEmail || !newUserName) {
            setError('Email and name are required');
            return;
        }

        try {
            setIsLoading(true);

            // If current user is admin, force role to 'member' to prevent creating privileged accounts
            const roleToSend = userRole === 'admin' ? 'member' : newUserRole;

            const response = await fetch('/api/users/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: newUserEmail,
                    name: newUserName,
                    role: roleToSend,
                    password: newUserPassword || undefined
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to create user');
            }

            setSuccess(`User ${newUserName} created successfully`);
            setNewUserEmail('');
            setNewUserName('');
            setNewUserPassword('');
            setNewUserRole('member');

            // Reload users list
            await loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create user');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteUser = async (userId: string, email: string, targetRole?: UserRole) => {
        if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;

        // Frontend protection: admins are allowed to delete only 'member' accounts.
        if (userRole === 'admin' && targetRole && targetRole !== 'member') {
            setError('Admins can only delete member accounts.');
            return;
        }

        try {
            const response = await fetch(`/api/users/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });

            if (!response.ok) {
                throw new Error('Failed to delete user');
            }

            setSuccess('User deleted successfully');
            await loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete user');
        }
    };

    // call server to update a user's role (superuser only)
    const updateUserRole = async (userId: string, newRole: UserRole) => {
        setError('');
        setSuccess('');
        setIsLoading(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            if (!token) {
                setError('No session found. Please log in again.');
                setIsLoading(false);
                return;
            }

            const response = await fetch('/api/users/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ userId, role: newRole })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => null);
                throw new Error(err?.error || 'Failed to update user role');
            }

            setSuccess('User role updated');
            setError(''); // explicitly clear error on success
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, user_metadata: { ...(u.user_metadata || {}), role: newRole } } : u));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update user role');
            setSuccess('');
        } finally {
            setIsLoading(false);
        }
    };

    // Determine which users to show to the current viewer:
    const visibleUsers = userRole === 'admin'
        ? users.filter(u => (u.user_metadata?.role || 'member') === 'member')
        : users;

    return (
        <div className="container">
            <header className="dashboard-header">
                <h1 className="page-title">Settings</h1>

                <div className="user-controls">
                    <Link href="/dashboard" className="btn share-btn">Back to Dashboard</Link>

                    {/* Only superusers see Attendance and Payment links */}
                    {userRole === 'superuser' && (
                        <>
                            <Link href="/attendance" className="btn share-btn">Attendance</Link>
                            <Link href="/payment" className="btn share-btn">Payment</Link>
                        </>
                    )}

                    <button
                        className="btn share-btn logout"
                        onClick={async () => {
                            await supabase.auth.signOut();
                            router.push('/');
                        }}
                    >
                        Logout
                    </button>
                </div>
            </header>

            <main>
                <div className="settings-container">
                    {/* Current User Info */}
                    <section className="settings-card">
                        <h2>Your Account</h2>
                        <div className="user-info">
                            <p><strong>Name:</strong> {userName}</p>
                            <p><strong>Role:</strong> <span className={`role-badge ${userRole}`}>{userRole.toUpperCase()}</span></p>
                        </div>
                    </section>

                    {/* Add New User */}
                    {/* Admins and superusers can add new users. Admins can only create 'member' accounts. */}
                    {(userRole === 'superuser' || userRole === 'admin') && (
                        <section className="settings-card">
                            <h2>Add New User</h2>

                            {error && <div className="error-message">{error}</div>}
                            {success && <div className="success-message">{success}</div>}

                            <form onSubmit={handleAddUser} className="user-form">
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
                                    <input
                                        type="password"
                                        id="password"
                                        value={newUserPassword}
                                        onChange={(e) => setNewUserPassword(e.target.value)}
                                        placeholder="Temporary password (optional)"
                                        disabled={isLoading}
                                    />
                                </div>

                                <div className="form-group">
                                    <label htmlFor="role">Role *</label>

                                    {/* If current user is admin, only show member and disable changing */}
                                    {userRole === 'admin' ? (
                                        <select id="role" value={'member'} disabled>
                                            <option value="member">Member</option>
                                        </select>
                                    ) : (
                                        <select
                                            id="role"
                                            value={newUserRole}
                                            onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                                            disabled={isLoading}
                                        >
                                            <option value="member">Member</option>
                                            <option value="admin">Admin</option>
                                            <option value="superuser">Superuser</option>
                                        </select>
                                    )}
                                </div>

                                <button type="submit" className="submit-btn" disabled={isLoading}>
                                    {isLoading ? 'Creating User...' : 'Add User'}
                                </button>
                            </form>
                        </section>
                    )}

                    {/* Users List (manage) */}
                    {(userRole === 'superuser' || userRole === 'admin') && (
                        <section className="settings-card">
                            <h2>Manage Users</h2>

                            {isLoading ? (
                                <p>Loading users...</p>
                            ) : visibleUsers.length === 0 ? (
                                <p>No users found</p>
                            ) : (
                                <div className="users-table">
                                    <table>
                                        <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Email</th>
                                            <th>Role</th>
                                            <th>Actions</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {visibleUsers.map((managedUser) => {
                                            const isSelf = managedUser.id === currentUserId;

                                            return (
                                                <tr key={managedUser.id}>
                                                    <td>{managedUser.user_metadata?.name || 'N/A'}</td>
                                                    <td>{managedUser.email}</td>
                                                    <td>
                                                        {userRole === 'superuser' ? (
                                                            <select
                                                                className="role-select"
                                                                value={(managedUser.user_metadata?.role as UserRole) || 'member'}
                                                                onChange={async (e) => {
                                                                    const selected = e.target.value as UserRole;
                                                                    setError('');
                                                                    setSuccess('');

                                                                    if (isSelf) {
                                                                        setError('You cannot change your own role.');
                                                                        setUsers(prev => [...prev]);
                                                                        return;
                                                                    }

                                                                    if (
                                                                        managedUser.user_metadata?.role !== selected &&
                                                                        !confirm(`Change role from ${(managedUser.user_metadata?.role || 'member').toUpperCase()} to ${selected.toUpperCase()}?`)
                                                                    ) {
                                                                        setUsers(prev => [...prev]);
                                                                        return;
                                                                    }

                                                                    await updateUserRole(managedUser.id, selected);
                                                                }}
                                                                disabled={isLoading || isSelf}
                                                                title={isSelf ? 'You cannot change your own role' : undefined}
                                                            >
                                                                <option value="member">Member</option>
                                                                <option value="admin">Admin</option>
                                                                <option value="superuser">Superuser</option>
                                                            </select>
                                                        ) : (
                                                            <span className={`role-badge ${managedUser.user_metadata?.role || 'member'}`}>
                        {(managedUser.user_metadata?.role || 'member').toUpperCase()}
                    </span>
                                                        )}
                                                    </td>

                                                    <td>
                                                        {userRole === 'superuser' ? (
                                                            <button
                                                                onClick={() => handleDeleteUser(
                                                                    managedUser.id,
                                                                    managedUser.email,
                                                                    managedUser.user_metadata?.role as UserRole
                                                                )}
                                                                className="delete-btn-small"
                                                                disabled={isLoading || isSelf}
                                                                title={isSelf ? 'You cannot delete your own account' : undefined}
                                                            >
                                                                Delete
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => handleDeleteUser(
                                                                    managedUser.id,
                                                                    managedUser.email,
                                                                    managedUser.user_metadata?.role as UserRole
                                                                )}
                                                                className="delete-btn-small"
                                                                disabled={isLoading || managedUser.user_metadata?.role !== 'member' || isSelf}
                                                                title={
                                                                    isSelf
                                                                        ? 'You cannot delete your own account'
                                                                        : managedUser.user_metadata?.role !== 'member'
                                                                            ? 'Admins can only delete member accounts'
                                                                            : undefined
                                                                }
                                                            >
                                                                Delete
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>
                    )}
                </div>
            </main>
        </div>
    );
}