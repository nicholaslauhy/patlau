import type { UserRole } from "./server-auth";

export type OperationsLinkTone =
    | "blue"
    | "green"
    | "purple"
    | "amber"
    | "teal"
    | "slate";

export type OperationsLink = {
    title: string;
    description: string;
    href: string;
    tone: OperationsLinkTone;
    allowedRoles: UserRole[];
};

export const MAX_QUICK_WORKFLOWS = 5;

const OPERATIONS_LINKS: OperationsLink[] = [
    {
        title: "Weekend attendance",
        description: "Open the existing student table and attendance controls.",
        href: "/dashboard",
        tone: "blue",
        allowedRoles: ["superuser", "admin", "member"],
    },
    {
        title: "Weekend attendance report",
        description: "Review session attendance without changing student records.",
        href: "/app/weekend/session-reports",
        tone: "blue",
        allowedRoles: ["superuser", "admin", "member"],
    },
    {
        title: "Detailed Weekend attendance",
        description: "Open the superuser Weekend attendance-management view.",
        href: "/attendance",
        tone: "blue",
        allowedRoles: ["superuser"],
    },
    {
        title: "Add Weekend student",
        description: "Open the existing role-aware student registration form.",
        href: "/add",
        tone: "green",
        allowedRoles: ["superuser", "admin"],
    },
    {
        title: "Coach attendance",
        description: "Prepare Saturday or Sunday availability polls.",
        href: "/coachattendance",
        tone: "teal",
        allowedRoles: ["superuser", "admin"],
    },
    {
        title: "Add 1-1 student",
        description: "Use the existing role-aware 1-1 registration form.",
        href: "/training/add",
        tone: "green",
        allowedRoles: ["superuser", "admin"],
    },
    {
        title: "1-1 training",
        description: "Manage the schedule and record 1-1 attendance.",
        href: "/training",
        tone: "green",
        allowedRoles: ["superuser", "admin"],
    },
    {
        title: "1-1 attendance report",
        description: "Review recorded 1-1 sessions and attendance.",
        href: "/app/training/session-reports",
        tone: "green",
        allowedRoles: ["superuser", "admin"],
    },
    {
        title: "1-1 payments",
        description: "Track payment for scheduled 1-1 sessions.",
        href: "/trngpayment",
        tone: "amber",
        allowedRoles: ["superuser"],
    },
    {
        title: "Parent support",
        description: "Review escalations, conversations, and chatbot information.",
        href: "/chats",
        tone: "teal",
        allowedRoles: ["superuser"],
    },
    {
        title: "Weekend payments",
        description: "Review payment status, history, and Telegram summaries.",
        href: "/payment",
        tone: "amber",
        allowedRoles: ["superuser"],
    },
    {
        title: "Weekday programme",
        description: "Open Weekday attendance, students, reports, and payments.",
        href: "/weekday/attendance",
        tone: "blue",
        allowedRoles: ["superuser"],
    },
    {
        title: "Add Weekday student",
        description: "Register a student and configure their weekly sessions.",
        href: "/weekday/add",
        tone: "blue",
        allowedRoles: ["superuser"],
    },
    {
        title: "Weekday attendance report",
        description: "Review Weekday attendance grouped by session date.",
        href: "/app/weekday/session-reports",
        tone: "blue",
        allowedRoles: ["superuser"],
    },
    {
        title: "Weekday payments",
        description: "Review monthly Weekday payment totals and status.",
        href: "/weekday/payment",
        tone: "amber",
        allowedRoles: ["superuser"],
    },
    {
        title: "MatchPlay programme",
        description: "Open MatchPlay attendance, students, reports, and payments.",
        href: "/matchplay/attendance",
        tone: "purple",
        allowedRoles: ["superuser"],
    },
    {
        title: "Add MatchPlay student",
        description: "Register a student in the MatchPlay programme.",
        href: "/matchplay/add",
        tone: "purple",
        allowedRoles: ["superuser"],
    },
    {
        title: "MatchPlay attendance report",
        description: "Review MatchPlay attendance grouped by session date.",
        href: "/app/matchplay/session-reports",
        tone: "purple",
        allowedRoles: ["superuser"],
    },
    {
        title: "MatchPlay payments",
        description: "Review monthly MatchPlay payment totals and status.",
        href: "/matchplay/payment",
        tone: "amber",
        allowedRoles: ["superuser"],
    },
    {
        title: "Makeup credits",
        description: "Review available credits, usage, and programme transfers.",
        href: "/makeup",
        tone: "amber",
        allowedRoles: ["superuser"],
    },
    {
        title: "Makeup payments",
        description: "Track makeup top-up payments and payment events.",
        href: "/makeup/payment",
        tone: "amber",
        allowedRoles: ["superuser"],
    },
    {
        title: "Audit logs",
        description: "Investigate application activity and delivery events.",
        href: "/audit-logs",
        tone: "slate",
        allowedRoles: ["superuser"],
    },
];

export function operationsLinksForRole(role: UserRole) {
    return OPERATIONS_LINKS.filter((item) => item.allowedRoles.includes(role));
}

const DEFAULT_QUICK_WORKFLOWS: Record<UserRole, string[]> = {
    member: [
        "/dashboard",
        "/app/weekend/session-reports",
    ],
    admin: [
        "/dashboard",
        "/add",
        "/coachattendance",
        "/training",
        "/app/training/session-reports",
    ],
    superuser: [
        "/dashboard",
        "/weekday/attendance",
        "/matchplay/attendance",
        "/training",
        "/chats",
    ],
};

export function normalizeQuickWorkflowHrefs(
    role: UserRole,
    hrefs: unknown,
) {
    const allowedHrefs = new Set(
        operationsLinksForRole(role).map((item) => item.href),
    );
    const values = Array.isArray(hrefs) ? hrefs : [];

    return Array.from(
        new Set(
            values.filter(
                (href): href is string =>
                    typeof href === "string" && allowedHrefs.has(href),
            ),
        ),
    ).slice(0, MAX_QUICK_WORKFLOWS);
}

export function defaultQuickWorkflowHrefsForRole(role: UserRole) {
    return normalizeQuickWorkflowHrefs(role, DEFAULT_QUICK_WORKFLOWS[role]);
}

export function dropQuickWorkflow({
    role,
    selectedHrefs,
    draggedHref,
    targetHref = null,
}: {
    role: UserRole;
    selectedHrefs: string[];
    draggedHref: string;
    targetHref?: string | null;
}) {
    const allowedHrefs = new Set(
        operationsLinksForRole(role).map((item) => item.href),
    );
    const current = normalizeQuickWorkflowHrefs(role, selectedHrefs);
    if (!allowedHrefs.has(draggedHref)) return current;

    const draggedWasSelected = current.includes(draggedHref);
    if (!draggedWasSelected && current.length >= MAX_QUICK_WORKFLOWS) {
        if (!targetHref || !current.includes(targetHref)) return current;
        return current.map((href) => href === targetHref ? draggedHref : href);
    }

    const reordered = current.filter((href) => href !== draggedHref);
    const targetIndex = targetHref ? reordered.indexOf(targetHref) : -1;
    reordered.splice(
        targetIndex >= 0 ? targetIndex : reordered.length,
        0,
        draggedHref,
    );
    return reordered.slice(0, MAX_QUICK_WORKFLOWS);
}
