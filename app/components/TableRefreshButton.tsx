'use client';

type TableRefreshButtonProps = {
    onRefresh: () => void | Promise<void>;
    refreshing: boolean;
    label?: string;
    className?: string;
};

export default function TableRefreshButton({
    onRefresh,
    refreshing,
    label = 'Refresh table',
    className = '',
}: TableRefreshButtonProps) {
    return (
        <button
            type="button"
            className={`table-refresh-button ${className}`.trim()}
            onClick={() => void onRefresh()}
            disabled={refreshing}
            aria-label={refreshing ? `${label}, refreshing` : label}
            aria-busy={refreshing}
            title={label}
        >
            <svg
                className="table-refresh-button__icon"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
            >
                <path
                    d="M20 11a8 8 0 1 0-2.34 5.66M20 11V5m0 6h-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
            <span>{refreshing ? 'Refreshing\u2026' : 'Refresh'}</span>
        </button>
    );
}
