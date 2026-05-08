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

    // Form state
    const [newUserEmail, setNewUserEmail] = useState('');
    const [newUserName, setNewUserName] = useState('');
    const [newUserRole, setNewUserRole] = useState<UserRole>('member');

    useEffect(() => {
        loadUserInfo();
        loadUsers();
    }, []);

    const loadUserInfo = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
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
            const response = await fetch('/api/users/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: newUserEmail,
                    name: newUserName,
                    role: newUserRole
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to create user');
            }

            setSuccess(`User ${newUserName} created successfully`);
            setNewUserEmail('');
            setNewUserName('');
            setNewUserRole('member');

            // Reload users list
            await loadUsers();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create user');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteUser = async (userId: string, email: string) => {
        if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;

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

    return (
        <div className="container">
            <header className="dashboard-header">
                <h1 className="page-title">Settings</h1>
                <div className="user-controls">
                    <Link href="/dashboard" className="btn share-btn">Back to Dashboard</Link>
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
                                    <label htmlFor="role">Role *</label>
                                    <select
                                        id="role"
                                        value={newUserRole}
                                        onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                                        disabled={isLoading}
                                    >
                                        <option value="member">Member</option>
                                        {userRole === 'superuser' && <option value="admin">Admin</option>}
                                        {userRole === 'superuser' && <option value="superuser">Superuser</option>}
                                    </select>
                                </div>

                                <button type="submit" className="submit-btn" disabled={isLoading}>
                                    {isLoading ? 'Creating User...' : 'Add User'}
                                </button>
                            </form>
                        </section>
                    )}

                    {/* Users List */}
                    {(userRole === 'superuser' || userRole === 'admin') && (
                        <section className="settings-card">
                            <h2>Manage Users</h2>

                            {isLoading ? (
                                <p>Loading users...</p>
                            ) : users.length === 0 ? (
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
                                        {users.map((user) => (
                                            <tr key={user.id}>
                                                <td>{user.user_metadata?.name || 'N/A'}</td>
                                                <td>{user.email}</td>
                                                <td>
                                    <span className={`role-badge ${user.user_metadata?.role || 'member'}`}>
                                      {(user.user_metadata?.role || 'member').toUpperCase()}
                                    </span>
                                                </td>
                                                <td>
                                                    <button
                                                        onClick={() => handleDeleteUser(user.id, user.email)}
                                                        className="delete-btn-small"
                                                        disabled={isLoading}
                                                    >
                                                        Delete
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
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