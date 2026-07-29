import type { UserRole } from "../app/lib/server-auth";

export type WeekendOperationsSummary = {
    totalStudents: number;
    saturdayStudents: number;
    sundayStudents: number;
    completedCourses: number;
    todayLessonDay: "Saturday" | "Sunday" | null;
    todayScheduled: number;
    todayRecorded: number;
    todayRemaining: number;
};

export type ManagementOperationsSummary = {
    activeOneToOneStudents: number;
    upcomingOneToOneSessions: number;
    activeCoachPolls: number;
};

export type SuperuserOperationsSummary = {
    outstandingWeekendPayments: number;
    escalatedParentChats: number;
    unreadParentMessages: number;
    activeWeekdayStudents: number;
    activeMatchPlayStudents: number;
    availableMakeupCredits: number;
};

export type OperationsSummary = {
    role: UserRole;
    generatedAt: string;
    todayDateKey: string;
    todayLabel: string;
    weekend: WeekendOperationsSummary;
    management: ManagementOperationsSummary | null;
    superuser: SuperuserOperationsSummary | null;
    warnings: string[];
};
