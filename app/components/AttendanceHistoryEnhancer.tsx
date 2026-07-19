'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

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
        const generatedHints = new Set<HTMLDivElement>();
        const observedHosts = new Set<HTMLElement>();
        let frameId = 0;

        const removeToggle = (cell: HTMLElement) => {
            toggleCleanups.get(cell)?.();
            toggleCleanups.delete(cell);
            cell.querySelector<HTMLElement>(':scope > .ah-toggle')?.remove();
            delete cell.dataset.enhanced;
        };

        const enhanceHistoryCell = (cell: HTMLElement) => {
            const list = cell.querySelector<HTMLUListElement>(':scope > ul');
            if (!list) {
                removeToggle(cell);
                return;
            }

            const items = Array.from(list.querySelectorAll<HTMLLIElement>(':scope > li'));
            if (items.length === 0) {
                removeToggle(cell);
                list.hidden = true;
                return;
            }

            items.forEach((item) => {
                item.classList.remove('ah-attended', 'ah-missed', 'ah-makeup');
                item.classList.add(getStatusClass(item.textContent || ''));
            });

            const existingToggle = cell.querySelector<HTMLButtonElement>(':scope > .ah-toggle');
            if (existingToggle && existingToggle.nextElementSibling === list) {
                const count = existingToggle.querySelector<HTMLElement>('.ah-count');
                if (count) count.textContent = `${items.length} record${items.length === 1 ? '' : 's'}`;
                return;
            }

            removeToggle(cell);
            const toggle = document.createElement('button');
            toggle.className = 'ah-toggle';
            toggle.type = 'button';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.innerHTML = `
                <span aria-hidden="true">↻</span>
                <span class="ah-count">${items.length} record${items.length === 1 ? '' : 's'}</span>
                <svg class="ah-chevron" width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>`;

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

        const updateScrollHint = (host: HTMLElement, hint: HTMLElement) => {
            const overflowed = host.scrollWidth > host.clientWidth + 2;
            hint.hidden = !overflowed;
            host.tabIndex = overflowed ? 0 : -1;
            if (overflowed) {
                host.setAttribute('role', 'region');
                host.setAttribute('aria-label', 'Scrollable data table');
            } else {
                host.removeAttribute('role');
                host.removeAttribute('aria-label');
            }
        };

        const resizeObserver = new ResizeObserver(() => scheduleEnhance());

        const enhanceTable = (table: HTMLTableElement) => {
            table.classList.add('responsive-data-table');
            const columnCount = table.querySelectorAll('thead tr:first-child > th').length || 6;
            const minimumWidth = Math.min(1900, Math.max(720, columnCount * 135));
            table.style.setProperty('--data-table-min-width', `${minimumWidth}px`);

            let host = table.closest<HTMLElement>('.table-scroll, .user-scroll');
            if (!host) host = table.closest<HTMLElement>('.table-container');

            if (!host) {
                const parent = table.parentElement;
                if (!parent) return;
                const wrapper = document.createElement('div');
                wrapper.className = 'route-table-scroll route-table-scroll-generated';
                parent.insertBefore(wrapper, table);
                wrapper.appendChild(table);
                generatedWrappers.add(wrapper);
                host = wrapper;
            } else {
                host.classList.add('route-table-scroll');
            }

            if (!observedHosts.has(host)) {
                resizeObserver.observe(host);
                observedHosts.add(host);
            }

            const hintOwner = host.closest('.table-container') || host;
            let hint = hintOwner.nextElementSibling as HTMLElement | null;
            if (!hint?.classList.contains('table-scroll-hint')) {
                hint = document.createElement('div');
                hint.className = 'table-scroll-hint';
                hint.textContent = 'Scroll horizontally to view all columns';
                hintOwner.insertAdjacentElement('afterend', hint);
                generatedHints.add(hint as HTMLDivElement);
            }
            updateScrollHint(host, hint);
        };

        const enhanceAll = () => {
            document.querySelectorAll<HTMLElement>('td.attendance-history').forEach(enhanceHistoryCell);
            document.querySelectorAll<HTMLTableElement>('main table').forEach(enhanceTable);
        };

        const scheduleEnhance = () => {
            cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(enhanceAll);
        };

        enhanceAll();
        const mutationObserver = new MutationObserver(scheduleEnhance);
        mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

        return () => {
            mutationObserver.disconnect();
            resizeObserver.disconnect();
            cancelAnimationFrame(frameId);
            toggleCleanups.forEach((cleanup) => cleanup());
            toggleCleanups.clear();
            observedHosts.clear();

            document.querySelectorAll<HTMLElement>('.route-table-scroll').forEach((host) => {
                host.classList.remove('route-table-scroll');
                host.removeAttribute('role');
                host.removeAttribute('aria-label');
                host.removeAttribute('tabindex');
            });
            document.querySelectorAll<HTMLTableElement>('.responsive-data-table').forEach((table) => {
                table.classList.remove('responsive-data-table');
                table.style.removeProperty('--data-table-min-width');
            });
            generatedHints.forEach((hint) => hint.remove());
            generatedWrappers.forEach((wrapper) => {
                const table = wrapper.querySelector(':scope > table');
                if (table && wrapper.parentElement) wrapper.parentElement.insertBefore(table, wrapper);
                wrapper.remove();
            });
        };
    }, [pathname]);

    return null;
}
