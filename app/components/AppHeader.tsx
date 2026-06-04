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

const trainingItems: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', allowedRoles: ['superuser', 'admin', 'member'] },
    { label: 'Add Student', href: '/add', allowedRoles: ['superuser', 'admin'] },
    { label: 'Attendance', href: '/attendance', allowedRoles: ['superuser'] },
    { label: 'Payment', href: '/payment', allowedRoles: ['superuser'] }
];

const oneToOneItems: NavItem[] = [
    { label: '1-1 Training', href: '/training', allowedRoles: ['superuser', 'admin'] },
    { label: '1-1 Payment', href: '/trngpayment', allowedRoles: ['superuser'] }
];

const menuBoxStyle: React.CSSProperties = {
    position: 'absolute',
    right: 0,
    top: 'calc(100% + 6px)',
    minWidth: '200px',
    background: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '14px',
    boxShadow: '0 14px 34px rgba(0,0,0,0.14)',
    padding: '8px',
    zIndex: 2000
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
    fontWeight: 600,
    whiteSpace: 'nowrap',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.95rem',
    lineHeight: 1.2,
    textAlign: 'left'
};


const hoverMenuItemStyle: React.CSSProperties = {
    background: '#eff6ff',
    color: '#1d4ed8',
    transform: 'translateX(2px)'
};

const activeMenuItemStyle: React.CSSProperties = {
    background: '#2563eb',
    color: 'white',
    boxShadow: '0 6px 14px rgba(37,99,235,0.28)'
};

const activePillStyle: React.CSSProperties = {
    marginLeft: 'auto',
    fontSize: '0.7rem',
    fontWeight: 800,
    padding: '3px 7px',
    borderRadius: '999px',
    background: 'rgba(255,255,255,0.22)',
    color: 'white'
};

function MenuLink({
                      href,
                      children,
                      active = false,
                      onClick
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
                transition: 'background 0.16s ease, color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease',
                ...(hovered && !active ? hoverMenuItemStyle : {}),
                ...(active ? activeMenuItemStyle : {})
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

function MenuButton({
                        children,
                        onClick
                    }: {
    children: React.ReactNode;
    onClick: () => void;
}) {
    const [hovered, setHovered] = useState(false);

    return (
        <button
            type="button"
            className="account-menu-link"
            onClick={onClick}
            style={{
                ...menuItemStyle,
                transition: 'background 0.16s ease, color 0.16s ease, transform 0.16s ease',
                ...(hovered ? hoverMenuItemStyle : {})
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

function NavDropdown({ label, items, userRole }: { label: string; items: NavItem[]; userRole: UserRole | null }) {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    const visibleItems = items.filter(item => userRole && item.allowedRoles.includes(userRole));

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
        <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
                type="button"
                className="btn share-btn"
                onClick={() => setOpen(prev => !prev)}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                {label} ▾
            </button>

            {open && (
                <div role="menu" style={menuBoxStyle}>
                    {visibleItems.map(item => {
                        const isActive = pathname === item.href;

                        return (
                            <MenuLink
                                key={item.href}
                                href={item.href}
                                active={isActive}
                                onClick={() => setOpen(false)}
                            >
                                {item.label}
                            </MenuLink>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default function AppHeader({ title, userName, userRole, mode = 'dashboard' }: AppHeaderProps) {
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
        <header className="dashboard-header">
            <div className="header-left">
                <div ref={accountRef} className="brand" style={{ position: 'relative' }}>
                    <button
                        className="account-avatar-btn"
                        onClick={() => setShowAccountMenu(prev => !prev)}
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
                                zIndex: 2000
                            }}
                        >
                            <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid #f3f4f6', marginBottom: '6px' }}>
                                <p className="account-name" style={{ margin: 0, fontWeight: 700, color: '#111827' }}>
                                    {userName || 'User'}
                                </p>
                                <p className="account-role" style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#6b7280', letterSpacing: '0.04em' }}>
                                    {userRole?.toUpperCase() || 'MEMBER'}
                                </p>
                            </div>

                            <MenuLink
                                href="/settings"
                                active={pathname === '/settings'}
                                onClick={() => setShowAccountMenu(false)}
                            >
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

                <h1 className="page-title">{title}</h1>
            </div>

            <div className="user-controls">
                {mode === 'dashboard' ? (
                    <>
                        <NavDropdown label="Training" items={trainingItems} userRole={userRole} />
                        <NavDropdown label="1-1" items={oneToOneItems} userRole={userRole} />
                    </>
                ) : (
                    <Link href="/dashboard" className="btn share-btn">
                        Return to Dashboard
                    </Link>
                )}
            </div>
        </header>
    );
}
