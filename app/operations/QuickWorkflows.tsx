"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
    MAX_QUICK_WORKFLOWS,
    defaultQuickWorkflowHrefsForRole,
    dropQuickWorkflow,
    normalizeQuickWorkflowHrefs,
    operationsLinksForRole,
    type OperationsLink,
} from "../lib/operations-access";
import type { UserRole } from "../lib/server-auth";
import "./quick-workflows.css";

type QuickWorkflowsProps = {
    role: UserRole;
    userId: string;
};

const storageKeyFor = (userId: string) =>
    `patlau.operations.quick-workflows.${userId}`;

function WorkflowLinkCard({ item }: { item: OperationsLink }) {
    return (
        <Link
            href={item.href}
            className={`operations-link-card operations-tone--${item.tone}`}
        >
            <span className="operations-link-card__marker" aria-hidden="true" />
            <span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
            </span>
            <span className="operations-link-card__arrow" aria-hidden="true">
                →
            </span>
        </Link>
    );
}

export default function QuickWorkflows({
    role,
    userId,
}: QuickWorkflowsProps) {
    const [editing, setEditing] = useState(false);
    const [draggedHref, setDraggedHref] = useState<string | null>(null);
    const [selectedHrefs, setSelectedHrefs] = useState<string[]>(
        () => defaultQuickWorkflowHrefsForRole(role),
    );
    const allLinks = useMemo(() => operationsLinksForRole(role), [role]);
    const linksByHref = useMemo(
        () => new Map(allLinks.map((item) => [item.href, item])),
        [allLinks],
    );

    useEffect(() => {
        const key = storageKeyFor(userId);
        const storedValue = window.localStorage.getItem(key);

        if (storedValue === null) {
            setSelectedHrefs(defaultQuickWorkflowHrefsForRole(role));
            return;
        }

        try {
            setSelectedHrefs(
                normalizeQuickWorkflowHrefs(role, JSON.parse(storedValue)),
            );
        } catch {
            setSelectedHrefs(defaultQuickWorkflowHrefsForRole(role));
        }
    }, [role, userId]);

    const saveSelection = (nextHrefs: string[]) => {
        const normalized = normalizeQuickWorkflowHrefs(role, nextHrefs);
        setSelectedHrefs(normalized);
        window.localStorage.setItem(
            storageKeyFor(userId),
            JSON.stringify(normalized),
        );
    };

    const selectedLinks = selectedHrefs
        .map((href) => linksByHref.get(href))
        .filter((item): item is OperationsLink => Boolean(item));
    const availableLinks = allLinks.filter(
        (item) => !selectedHrefs.includes(item.href),
    );

    const dropWorkflow = (targetHref?: string) => {
        if (!draggedHref) return;
        saveSelection(
            dropQuickWorkflow({
                role,
                selectedHrefs,
                draggedHref,
                targetHref,
            }),
        );
        setDraggedHref(null);
    };

    const moveWorkflow = (href: string, direction: -1 | 1) => {
        const currentIndex = selectedHrefs.indexOf(href);
        const targetIndex = currentIndex + direction;
        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= selectedHrefs.length) {
            return;
        }

        const next = [...selectedHrefs];
        [next[currentIndex], next[targetIndex]] = [
            next[targetIndex],
            next[currentIndex],
        ];
        saveSelection(next);
    };

    const addWorkflow = (href: string) => {
        if (selectedHrefs.length >= MAX_QUICK_WORKFLOWS) return;
        saveSelection([...selectedHrefs, href]);
    };

    const removeWorkflow = (href: string) => {
        saveSelection(selectedHrefs.filter((item) => item !== href));
    };

    return (
        <section className="operations-section">
            <div className="operations-section__heading">
                <div>
                    <span className="operations-eyebrow">Your access</span>
                    <h2>Quick workflows</h2>
                    <p>
                        Keep up to five role-approved workflows here. Your choices
                        are saved on this device.
                    </p>
                </div>
                <button
                    type="button"
                    className="operations-customise-button"
                    onClick={() => setEditing((current) => !current)}
                >
                    {editing ? "Done" : "Customise"}
                </button>
            </div>

            {editing ? (
                <div className="operations-workflow-editor">
                    <div className="operations-workflow-editor__header">
                        <div>
                            <strong>Shown on your dashboard</strong>
                            <span>
                                Drag to reorder. Drop a new workflow onto a selected
                                card to replace it.
                            </span>
                        </div>
                        <span className="operations-workflow-count">
                            {selectedHrefs.length}/{MAX_QUICK_WORKFLOWS}
                        </span>
                    </div>

                    <div
                        className="operations-selected-workflows"
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => dropWorkflow()}
                    >
                        {selectedLinks.length === 0 && (
                            <div className="operations-workflow-empty">
                                Add a workflow from the available list below.
                            </div>
                        )}
                        {selectedLinks.map((item, index) => (
                            <article
                                key={item.href}
                                className={`operations-workflow-choice operations-tone--${item.tone}${draggedHref === item.href ? " is-dragging" : ""}`}
                                draggable
                                onDragStart={() => setDraggedHref(item.href)}
                                onDragEnd={() => setDraggedHref(null)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                    event.stopPropagation();
                                    dropWorkflow(item.href);
                                }}
                            >
                                <span
                                    className="operations-workflow-choice__handle"
                                    aria-hidden="true"
                                    title="Drag to reorder"
                                >
                                    ⋮⋮
                                </span>
                                <span className="operations-workflow-choice__copy">
                                    <strong>{item.title}</strong>
                                    <small>{item.description}</small>
                                </span>
                                <span className="operations-workflow-choice__controls">
                                    <button
                                        type="button"
                                        onClick={() => moveWorkflow(item.href, -1)}
                                        disabled={index === 0}
                                        aria-label={`Move ${item.title} earlier`}
                                    >
                                        ←
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => moveWorkflow(item.href, 1)}
                                        disabled={index === selectedLinks.length - 1}
                                        aria-label={`Move ${item.title} later`}
                                    >
                                        →
                                    </button>
                                    <button
                                        type="button"
                                        className="operations-workflow-choice__remove"
                                        onClick={() => removeWorkflow(item.href)}
                                        aria-label={`Remove ${item.title} from Quick workflows`}
                                    >
                                        ×
                                    </button>
                                </span>
                            </article>
                        ))}
                    </div>

                    <div className="operations-available-workflows">
                        <strong>Available workflows</strong>
                        <div>
                            {availableLinks.map((item) => (
                                <article
                                    key={item.href}
                                    className={`operations-available-workflow operations-tone--${item.tone}`}
                                    draggable
                                    onDragStart={() => setDraggedHref(item.href)}
                                    onDragEnd={() => setDraggedHref(null)}
                                >
                                    <span>{item.title}</span>
                                    <button
                                        type="button"
                                        onClick={() => addWorkflow(item.href)}
                                        disabled={selectedHrefs.length >= MAX_QUICK_WORKFLOWS}
                                        aria-label={`Add ${item.title} to Quick workflows`}
                                    >
                                        Add
                                    </button>
                                </article>
                            ))}
                            {availableLinks.length === 0 && (
                                <span className="operations-available-workflows__empty">
                                    Every available workflow is already selected.
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="operations-link-grid">
                    {selectedLinks.map((item) => (
                        <WorkflowLinkCard key={item.href} item={item} />
                    ))}
                    {selectedLinks.length === 0 && (
                        <button
                            type="button"
                            className="operations-workflow-empty operations-workflow-empty--button"
                            onClick={() => setEditing(true)}
                        >
                            Choose your Quick workflows
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}
