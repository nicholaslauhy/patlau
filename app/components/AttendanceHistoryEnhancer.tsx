'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const TABLE_SCROLL_ROUTES = new Set([
    '/dashboard',
    '/attendance',
    '/payment',
    '/weekday/attendance',
    '/weekday/payment',
]);

const getStatusClass = (text: string) => {
    const value = text.toLowerCase();

    if (value.includes('missed')) return 'ah-missed';
    if (value.includes('makeup')) return 'ah-makeup';
    return 'ah-attended';
};

export default function AttendanceHistoryEnhancer() {
    const pathname = usePathname();

    useEffect(() => {
        const toggleCleanups = new Map<HTMLElement, () => void>();
        const generatedWrappers = new Set<HTMLDivElement>();
        let frameId = 0;

        const removeToggle = (cell: HTMLElement) => {
            toggleCleanups.get(cell)?.();
            toggleCleanups.delete(cell);
            cell.querySelector<HTMLElement>(':scope > .ah-toggle')?.remove();
            delete cell.dataset.enhanced;
        };

        const enhanceHistoryCell = (cell: HTMLElement) => {
            const existingToggle = cell.querySelector<HTMLButtonElement>(':scope > .ah-toggle');
            const list = cell.querySelector<HTMLUListElement>(':scope > ul');

            // After Undo, React may replace the list with "No history".
            // Remove the injected count immediately so it cannot become stale.
            if (!list) {
                removeToggle(cell);
                return;
            }

            const items = Array.from(list.querySelectorAll<HTMLLIElement>(':scope > li'));
            const count = items.length;

            if (count === 0) {
                removeToggle(cell);
                list.hidden = true;
                return;
            }

            items.forEach((item) => {
                item.classList.remove('ah-attended', 'ah-missed', 'ah-makeup');
                item.classList.add(getStatusClass(item.textContent || ''));
            });

            if (existingToggle && existingToggle.nextElementSibling === list) {
                const countLabel = existingToggle.querySelector<HTMLElement>('.ah-count');
                if (countLabel) {
                    countLabel.textContent = `${count} record${count === 1 ? '' : 's'}`;
                }
                return;
            }

            removeToggle(cell);

            const toggle = document.createElement('button');
            toggle.className = 'ah-toggle';
            toggle.type = 'button';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.innerHTML = `
                <span class="ah-history-icon" aria-hidden="true">↻</span>
                <span class="ah-count">${count} record${count === 1 ? '' : 's'}</span>
                <svg class="ah-chevron" width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
            `;

            list.hidden = true;
            cell.insertBefore(toggle, list);
            cell.dataset.enhanced = 'true';

            const handleClick = () => {
                const expanded = toggle.getAttribute('aria-expanded') === 'true';
                toggle.setAttribute('aria-expanded', String(!expanded));
                list.hidden = expanded;
            };

            toggle.addEventListener('click', handleClick);
            toggleCleanups.set(cell, () => toggle.removeEventListener('click', handleClick));
        };

        const enhanceTables = () => {
            if (!TABLE_SCROLL_ROUTES.has(pathname)) return;

            document.querySelectorAll<HTMLTableElement>('main table').forEach((table) => {
                table.classList.add('responsive-data-table');

                // Prefer the page's existing scroll wrapper. This preserves the
                // white table card and gives each table one internal scrollbar.
                const existingHost = table.closest<HTMLElement>('.table-scroll, .table-container');

                if (existingHost) {
                    existingHost.classList.add('route-table-scroll');
                    return;
                }

                // Some pages render a bare table. Wrap only that table rather
                // than making the whole page horizontally scrollable.
                const parent = table.parentElement;
                if (!parent || parent.classList.contains('route-table-scroll')) return;

                const wrapper = document.createElement('div');
                wrapper.className = 'route-table-scroll route-table-scroll-generated';
                parent.insertBefore(wrapper, table);
                wrapper.appendChild(table);
                generatedWrappers.add(wrapper);
            });
        };

        const enhanceAll = () => {
            document
                .querySelectorAll<HTMLElement>('td.attendance-history')
                .forEach(enhanceHistoryCell);

            enhanceTables();
        };

        const scheduleEnhance = () => {
            cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(enhanceAll);
        };

        enhanceAll();

        const observer = new MutationObserver(scheduleEnhance);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        return () => {
            observer.disconnect();
            cancelAnimationFrame(frameId);
            toggleCleanups.forEach((cleanup) => cleanup());
            toggleCleanups.clear();

            document.querySelectorAll<HTMLElement>('.route-table-scroll').forEach((host) => {
                host.classList.remove('route-table-scroll');
            });
            document.querySelectorAll<HTMLTableElement>('.responsive-data-table').forEach((table) => {
                table.classList.remove('responsive-data-table');
            });

            generatedWrappers.forEach((wrapper) => {
                const table = wrapper.querySelector(':scope > table');
                if (table && wrapper.parentElement) {
                    wrapper.parentElement.insertBefore(table, wrapper);
                }
                wrapper.remove();
            });
            generatedWrappers.clear();
        };
    }, [pathname]);

    return null;
}
