'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';

type UserRole = 'superuser' | 'admin' | 'member';
type HeaderMode = 'dashboard' | 'return';

interface AppHeaderProps {
    title: string;
    userName: string;
    userRole: UserRole | null;
    mode?: HeaderMode;
}

interface NavItem {
    label: string;
    href: string;
    allowedRoles: UserRole[];
}

const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Header order:
 * Weekday → MatchPlay → 1-1 → Weekend
 *
 * Role rules:
 * - superuser: everything
 * - admin: operational pages only
 * - member: Weekend Dashboard only
 */
const weekdayItems: NavItem[] = [
    { label: 'Add Weekday Student', href: '/weekday/add', allowedRoles: ['superuser'] },
    { label: 'Weekday Attendance', href: '/weekday/attendance', allowedRoles: ['superuser'] },
    { label: 'Weekday Payment', href: '/weekday/payment', allowedRoles: ['superuser'] },
];

const matchPlayItems: NavItem[] = [
    { label: 'Add MatchPlay Student', href: '/matchplay/add', allowedRoles: ['superuser'] },
    { label: 'MatchPlay Attendance', href: '/matchplay/attendance', allowedRoles: ['superuser'] },
    { label: 'MatchPlay Payment', href: '/matchplay/payment', allowedRoles: ['superuser'] },
];

const oneToOneItems: NavItem[] = [
    { label: 'Add 1-1 Student', href: '/training/add', allowedRoles: ['superuser', 'admin'] },
    { label: '1-1 Training', href: '/training', allowedRoles: ['superuser', 'admin'] },
    { label: '1-1 Payment', href: '/trngpayment', allowedRoles: ['superuser'] },
];

const weekendItems: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', allowedRoles: ['superuser', 'admin', 'member'] },
    { label: 'Add Student', href: '/add', allowedRoles: ['superuser', 'admin'] },
    { label: 'Attendance', href: '/attendance', allowedRoles: ['superuser'] },
    { label: 'Payment', href: '/payment', allowedRoles: ['superuser'] },
];

const menuBoxStyle: React.CSSProperties = {
    position: 'absolute',
    right: 0,
    top: 'calc(100% + 8px)',
    minWidth: '230px',
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '14px',
    boxShadow: '0 14px 34px rgba(0,0,0,0.14)',
    padding: '8px',
    zIndex: 3000,
};

const menuItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '10px 12px',
    borderRadius: '10px',
    color: '#374151',
    textDecoration: 'none',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.92rem',
    lineHeight: 1.2,
    textAlign: 'left',
};

const hoverMenuItemStyle: React.CSSProperties = {
    background: '#eff6ff',
    color: '#1d4ed8',
};

const activeMenuItemStyle: React.CSSProperties = {
    background: '#2563eb',
    color: 'white',
    boxShadow: '0 6px 14px rgba(37,99,235,0.28)',
};

const activePillStyle: React.CSSProperties = {
    marginLeft: 'auto',
    fontSize: '0.68rem',
    fontWeight: 900,
    padding: '3px 7px',
    borderRadius: '999px',
    background: 'rgba(255,255,255,0.22)',
    color: 'white',
};

const navButtonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    padding: '8px 12px',
    borderRadius: '10px',
    lineHeight: 1,
    minHeight: '36px',
};

function MenuLink({
                      href,
                      children,
                      active = false,
                      onClick,
                  }: {
    href: string;
    children: React.ReactNode;
    active?: boolean;
    onClick?: () => void;
}) {
    const [hovered, setHovered] = useState(false);

    return (
        <Link
            href={href}
            role="menuitem"
            style={{
                ...menuItemStyle,
                transition: 'background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease',
                ...(hovered && !active ? hoverMenuItemStyle : {}),
                ...(active ? activeMenuItemStyle : {}),
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            onClick={onClick}
        >
            <span>{children}</span>
            {active && <span style={activePillStyle}>Current</span>}
        </Link>
    );
}

function MenuButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
    const [hovered, setHovered] = useState(false);

    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                ...menuItemStyle,
                transition: 'background 0.16s ease, color 0.16s ease',
                ...(hovered ? hoverMenuItemStyle : {}),
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
        >
            {children}
        </button>
    );
}

function NavDropdown({
                         label,
                         items,
                         userRole,
                     }: {
    label: string;
    items: NavItem[];
    userRole: UserRole | null;
}) {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    const dropdownRef = useRef<HTMLDivElement | null>(null);

    const visibleItems = items.filter((item) => userRole && item.allowedRoles.includes(userRole));
    const active = visibleItems.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent | TouchEvent) => {
            if (!dropdownRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
        };
    }, []);

    if (visibleItems.length === 0) return null;

    return (
        <div
            ref={dropdownRef}
            style={{
                position: 'relative',
                display: 'inline-flex',
                flexShrink: 0,
                overflow: 'visible',
            }}
        >
            <button
                type="button"
                className="btn share-btn"
                onClick={() => setOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={open}
                style={{
                    ...navButtonStyle,
                    borderColor: active ? '#2563eb' : undefined,
                    color: active ? '#1d4ed8' : '#111827',
                    background: active ? '#eff6ff' : undefined,
                    boxShadow: active ? '0 0 0 2px rgba(37, 99, 235, 0.08)' : undefined,
                }}
            >
                {label} ▾
            </button>

            {open && (
                <div role="menu" style={menuBoxStyle}>
                    {visibleItems.map((item) => (
                        <MenuLink
                            key={item.href}
                            href={item.href}
                            active={pathname === item.href}
                            onClick={() => setOpen(false)}
                        >
                            {item.label}
                        </MenuLink>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function AppHeader({
                                      title,
                                      userName,
                                      userRole,
                                      mode = 'dashboard',
                                  }: AppHeaderProps) {
    const router = useRouter();
    const pathname = usePathname();
    const accountRef = useRef<HTMLDivElement | null>(null);
    const [showAccountMenu, setShowAccountMenu] = useState(false);

    useEffect(() => {
        const handlePointerDown = (event: MouseEvent | TouchEvent) => {
            if (!accountRef.current?.contains(event.target as Node)) {
                setShowAccountMenu(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
        };
    }, []);

    const signOut = async () => {
        const { error } = await supabase.auth.signOut();

        if (error) {
            alert('Logout failed');
            return;
        }

        router.push('/');
    };

    return (
        <header
            className="dashboard-header"
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'nowrap',
                overflow: 'visible',
            }}
        >
            <div
                className="header-left"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    minWidth: 0,
                    flex: '1 1 auto',
                }}
            >
                <div ref={accountRef} className="brand" style={{ position: 'relative', flexShrink: 0 }}>
                    <button
                        className="account-avatar-btn"
                        onClick={() => setShowAccountMenu((prev) => !prev)}
                        title="View account"
                        type="button"
                    >
                        👤
                    </button>

                    {showAccountMenu && (
                        <div
                            className="account-menu"
                            style={{
                                minWidth: '220px',
                                padding: '10px',
                                borderRadius: '14px',
                                boxShadow: '0 14px 34px rgba(0,0,0,0.14)',
                                border: '1px solid #e5e7eb',
                                background: 'white',
                                zIndex: 3000,
                            }}
                        >
                            <div
                                style={{
                                    padding: '8px 10px 10px',
                                    borderBottom: '1px solid #f3f4f6',
                                    marginBottom: '6px',
                                }}
                            >
                                <p className="account-name" style={{ margin: 0, fontWeight: 700, color: '#111827' }}>
                                    {userName || 'User'}
                                </p>
                                <p className="account-role" style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#6b7280' }}>
                                    {userRole?.toUpperCase() || 'MEMBER'}
                                </p>
                            </div>

                            <MenuLink href="/settings" active={pathname === '/settings'} onClick={() => setShowAccountMenu(false)}>
                                <span>⚙️</span>
                                <span>Settings</span>
                            </MenuLink>

                            <MenuButton onClick={signOut}>
                                <span>🚪</span>
                                <span>Logout</span>
                            </MenuButton>
                        </div>
                    )}
                </div>

                <h1
                    className="page-title"
                    style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                    }}
                >
                    {title}
                </h1>
            </div>

            <div
                className="user-controls"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '8px',
                    flexWrap: 'nowrap',
                    whiteSpace: 'nowrap',
                    overflow: 'visible',
                    minWidth: 'max-content',
                    flex: '0 0 auto',
                }}
            >
                {mode === 'dashboard' ? (
                    <>
                        <NavDropdown label="Weekday" items={weekdayItems} userRole={userRole} />
                        <NavDropdown label="MatchPlay" items={matchPlayItems} userRole={userRole} />
                        <NavDropdown label="1-1" items={oneToOneItems} userRole={userRole} />
                        <NavDropdown label="Weekend" items={weekendItems} userRole={userRole} />
                    </>
                ) : (
                    <Link href="/dashboard" className="btn share-btn" style={navButtonStyle}>
                        Return to Dashboard
                    </Link>
                )}
            </div>
        </header>
    );
}
