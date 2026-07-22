'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { type CSSProperties, useEffect, useRef, useState } from 'react';

type UserRole = 'superuser' | 'admin' | 'member';

interface AppHeaderProps {
    title: string;
    userName: string;
    userRole: UserRole | null;
    mode?: 'dashboard' | 'simple';
}

interface NavItem {
    label: string;
    href: string;
    allowedRoles: UserRole[];
}

const SECTION_COLORS: Record<string, string> = {
    '/app/weekend': '#1677c8',
    '/app/weekday': '#1677c8',
    '/app/matchplay': '#7950b3',
    '/app/training': '#168765',
    '/weekday': '#1677c8',
    '/matchplay': '#7950b3',
    '/training': '#168765',
    '/trngpayment': '#168765',
    '/makeup': '#d97706',
    '/chats': '#0f766e',
    '/audit-logs': '#475569',
    '/settings': '#64748b',
    '/myattendance': '#64748b',
    '/allattendance': '#64748b',
};

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const weekdayItems: NavItem[] = [
    { label: 'Add Weekday Student', href: '/weekday/add', allowedRoles: ['superuser'] },
    { label: 'Weekday Attendance', href: '/weekday/attendance', allowedRoles: ['superuser'] },
    { label: 'Attendance Report', href: '/app/weekday/session-reports', allowedRoles: ['superuser'] },
    { label: 'Weekday Payment', href: '/weekday/payment', allowedRoles: ['superuser'] },
];

const matchPlayItems: NavItem[] = [
    { label: 'Add MatchPlay Student', href: '/matchplay/add', allowedRoles: ['superuser'] },
    { label: 'MatchPlay Attendance', href: '/matchplay/attendance', allowedRoles: ['superuser'] },
    { label: 'Attendance Report', href: '/app/matchplay/session-reports', allowedRoles: ['superuser'] },
    { label: 'MatchPlay Payment', href: '/matchplay/payment', allowedRoles: ['superuser'] },
];

const oneToOneItems: NavItem[] = [
    { label: 'Add 1-1 Student', href: '/training/add', allowedRoles: ['superuser', 'admin'] },
    { label: '1-1 Training', href: '/training', allowedRoles: ['superuser', 'admin'] },
    { label: 'Attendance Report', href: '/app/training/session-reports', allowedRoles: ['superuser', 'admin'] },
    { label: '1-1 Payment', href: '/trngpayment', allowedRoles: ['superuser'] },
];

const makeupItems: NavItem[] = [
    { label: 'Makeup Credits', href: '/makeup', allowedRoles: ['superuser'] },
    { label: 'Makeup Payment', href: '/makeup/payment', allowedRoles: ['superuser'] },
];

const weekendItems: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', allowedRoles: ['superuser', 'admin', 'member'] },
    { label: 'Add Student', href: '/add', allowedRoles: ['superuser', 'admin'] },
    { label: 'Attendance', href: '/attendance', allowedRoles: ['superuser'] },
    { label: 'Attendance Report', href: '/app/weekend/session-reports', allowedRoles: ['superuser', 'admin', 'member'] },
    { label: 'Payment', href: '/payment', allowedRoles: ['superuser'] },
    { label: 'Coach Attendance', href: '/coachattendance', allowedRoles: ['superuser', 'admin'] },
];

function getSectionColor(pathname: string) {
    const matchingPrefix = Object.keys(SECTION_COLORS).find(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
    return matchingPrefix ? SECTION_COLORS[matchingPrefix] : '#1677c8';
}

function MenuItem({
    href,
    label,
    active,
    onSelect,
}: {
    href: string;
    label: string;
    active: boolean;
    onSelect: () => void;
}) {
    return (
        <Link
            href={href}
            role="menuitem"
            className={`menu-item${active ? ' is-active' : ''}`}
            onClick={onSelect}
        >
            <span>{label}</span>
            {active && <span className="menu-item__status">Current</span>}
        </Link>
    );
}

function ChevronIcon({ open }: { open: boolean }) {
    return (
        <svg
            className={`app-header__chevron${open ? ' is-open' : ''}`}
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
        >
            <path
                d="m5.5 7.5 4.5 4.5 4.5-4.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function NavMenu({ label, items, userRole }: { label: string; items: NavItem[]; userRole: UserRole | null }) {
    const pathname = usePathname();
    const rootRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const visibleItems = items.filter((item) => userRole && item.allowedRoles.includes(userRole));
    const active = visibleItems.some(
        (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
    );

    useEffect(() => {
        const dismiss = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', dismiss);
        return () => document.removeEventListener('pointerdown', dismiss);
    }, []);

    if (visibleItems.length === 0) return null;

    return (
        <div ref={rootRef} className="nav-menu">
            <button
                type="button"
                className={`app-header__nav-button${active ? ' is-active' : ''}`}
                onClick={() => setOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <span>{label}</span>
                <ChevronIcon open={open} />
            </button>

            {open && (
                <div className="nav-menu__panel" role="menu" aria-label={`${label} pages`}>
                    {visibleItems.map((item) => (
                        <MenuItem
                            key={item.href}
                            href={item.href}
                            label={item.label}
                            active={pathname === item.href}
                            onSelect={() => setOpen(false)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function AccountIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
            <path d="M4.8 20c.8-3.4 3.4-5.2 7.2-5.2s6.4 1.8 7.2 5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}

export default function AppHeader({ title, userName, userRole, mode = 'dashboard' }: AppHeaderProps) {
    const router = useRouter();
    const pathname = usePathname();
    const accountRef = useRef<HTMLDivElement>(null);
    const [accountOpen, setAccountOpen] = useState(false);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [escalatedChats, setEscalatedChats] = useState(0);
    const sectionColor = getSectionColor(pathname);

    useEffect(() => {
        let mounted = true;

        void supabase.auth.getUser().then(({ data }) => {
            if (mounted) setAvatarUrl(data.user?.user_metadata?.avatar_url || null);
        });

        const syncAvatar = (event: Event) => {
            const detail = (event as CustomEvent<{ avatarUrl: string | null }>).detail;
            setAvatarUrl(detail?.avatarUrl || null);
        };

        const dismiss = (event: PointerEvent) => {
            if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
        };
        window.addEventListener('avatar-updated', syncAvatar);
        document.addEventListener('pointerdown', dismiss);
        return () => {
            mounted = false;
            window.removeEventListener('avatar-updated', syncAvatar);
            document.removeEventListener('pointerdown', dismiss);
        };
    }, []);

    useEffect(() => {
        if (userRole !== 'superuser') {
            setEscalatedChats(0);
            return;
        }

        let active = true;
        const loadEscalations = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.access_token) return;
            try {
                const response = await fetch('/api/support?view=count', {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                });
                if (!response.ok) return;
                const data = await response.json();
                if (active) setEscalatedChats(Number(data.escalated || 0));
            } catch {
                // The Chats migration or configuration may not be active yet.
            }
        };

        void loadEscalations();
        const timer = window.setInterval(loadEscalations, 30000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [userRole]);

    const signOut = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.access_token) {
                const controller = new AbortController();
                const timeout = window.setTimeout(() => controller.abort(), 1800);
                try {
                    await fetch('/api/audit/events', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${session.access_token}`,
                        },
                        body: JSON.stringify({ eventType: 'authentication.logout' }),
                        signal: controller.signal,
                    });
                } finally {
                    window.clearTimeout(timeout);
                }
            }
        } catch {
            // Audit delivery must never prevent a user from signing out.
        }
        const { error } = await supabase.auth.signOut();
        if (error) {
            alert('Logout failed');
            return;
        }
        router.push('/');
    };

    return (
        <header
            className="dashboard-header app-header"
            style={{ '--header-accent': sectionColor } as CSSProperties}
        >
            <div className="app-header__identity">
                <div ref={accountRef} className="account-control">
                    <button
                        type="button"
                        className="account-avatar-btn"
                        style={{ backgroundColor: sectionColor }}
                        onClick={() => setAccountOpen((value) => !value)}
                        title="Open account menu"
                        aria-haspopup="menu"
                        aria-expanded={accountOpen}
                        aria-label="Open account menu"
                    >
                        {avatarUrl ? (
                            <img
                                src={avatarUrl}
                                alt=""
                                className="account-avatar-image"
                                onError={() => setAvatarUrl(null)}
                            />
                        ) : (
                            <AccountIcon />
                        )}
                    </button>

                    {accountOpen && (
                        <div className="account-menu" role="menu" aria-label="Account">
                            <div className="account-menu__summary">
                                <p className="account-menu__name">{userName || 'User'}</p>
                                <p className="account-menu__role">{userRole?.toUpperCase() || 'MEMBER'}</p>
                            </div>
                            <MenuItem href="/settings" label="Settings" active={pathname === '/settings'} onSelect={() => setAccountOpen(false)} />
                            <MenuItem href="/myattendance" label="My attendance" active={pathname === '/myattendance'} onSelect={() => setAccountOpen(false)} />
                            {userRole === 'superuser' && (
                                <>
                                    <MenuItem href="/allattendance" label="All attendance" active={pathname === '/allattendance'} onSelect={() => setAccountOpen(false)} />
                                    <MenuItem href="/audit-logs" label="Audit logs" active={pathname === '/audit-logs'} onSelect={() => setAccountOpen(false)} />
                                </>
                            )}
                            <button type="button" className="menu-item" role="menuitem" onClick={signOut}>
                                <span>Log out</span>
                            </button>
                        </div>
                    )}
                </div>

                <h1 className="app-header__title">{title}</h1>
            </div>

            <nav className="app-header__nav" aria-label="Primary navigation">
                {mode === 'dashboard' ? (
                    <>
                        {userRole === 'superuser' && (
                            <>
                                <Link
                                    href="/chats"
                                    className={`app-header__nav-button app-header__chat-link${pathname === '/chats' ? ' is-active' : ''}`}
                                >
                                    <span>Chats</span>
                                    {escalatedChats > 0 && (
                                        <span className="app-header__notification" aria-label={`${escalatedChats} escalated chats`}>
                                            {escalatedChats > 99 ? '99+' : escalatedChats}
                                        </span>
                                    )}
                                </Link>
                                <NavMenu label="Makeup" items={makeupItems} userRole={userRole} />
                                <NavMenu label="Weekday" items={weekdayItems} userRole={userRole} />
                                <NavMenu label="MatchPlay" items={matchPlayItems} userRole={userRole} />
                            </>
                        )}
                        {(userRole === 'superuser' || userRole === 'admin') && (
                            <NavMenu label="1-1" items={oneToOneItems} userRole={userRole} />
                        )}
                        {userRole === 'member' ? (
                            <>
                                {pathname !== '/dashboard' && (
                                    <Link href="/dashboard" className="app-header__nav-button">Dashboard</Link>
                                )}
                                {pathname !== '/app/weekend/session-reports' && (
                                    <Link
                                        href="/app/weekend/session-reports"
                                        className="app-header__nav-button"
                                    >
                                        Attendance Report
                                    </Link>
                                )}
                            </>
                        ) : (
                            <NavMenu label="Weekend" items={weekendItems} userRole={userRole} />
                        )}
                    </>
                ) : (
                    <Link href="/dashboard" className="app-header__nav-button">Return to dashboard</Link>
                )}
            </nav>
        </header>
    );
}
