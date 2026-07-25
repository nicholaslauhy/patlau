export const SUPPORT_IMAGE_TRIAGE_CATEGORIES = [
    "injury",
    "medical",
    "safety",
    "complaint",
    "refund",
    "dispute",
    "abuse",
    "urgent",
    "personal_record",
    "schedule",
    "date",
    "venue",
    "fees",
    "general_coaching",
    "uncertain",
    "unreadable",
] as const;

export type SupportImageTriageCategory = typeof SUPPORT_IMAGE_TRIAGE_CATEGORIES[number];
export type SupportImageTriageDecision =
    | "escalate_immediately"
    | "ai_can_answer"
    | "offer_coach_confirmation";
export type SupportImageProcessingDecision =
    | "continue"
    | "retry"
    | "superseded"
    | "coach_active";

/**
 * The compact, JSON-safe response shape requested from an image-capable model.
 * `categories` may include more than one topic, for example `fees` and
 * `refund`. Model prompts should use `uncertain` whenever they cannot classify
 * the image confidently, and `unreadable` when text or details cannot be read.
 */
export type SupportImageTriage = {
    categories: SupportImageTriageCategory[];
    confidence: number;
    readable: boolean;
    summary?: string;
};

const CATEGORY_SET = new Set<string>(SUPPORT_IMAGE_TRIAGE_CATEGORIES);
const IMMEDIATE_HUMAN_CATEGORIES = new Set<SupportImageTriageCategory>([
    "injury",
    "medical",
    "safety",
    "complaint",
    "refund",
    "dispute",
    "abuse",
    "urgent",
    "personal_record",
]);
const ROUTINE_AI_CATEGORIES = new Set<SupportImageTriageCategory>([
    "schedule",
    "date",
    "venue",
    "fees",
    "general_coaching",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSupportImageTriageCategory(value: unknown): value is SupportImageTriageCategory {
    return typeof value === "string" && CATEGORY_SET.has(value);
}

function normaliseModelJson(value: string) {
    return value
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
}

/**
 * Parses and validates a model's JSON response. It deliberately accepts only
 * the documented shape, so malformed or invented categories can safely fall
 * back to a Coach Patrick confirmation instead of being auto-handled.
 */
export function parseSupportImageTriage(value: unknown): SupportImageTriage | null {
    let candidate = value;
    if (typeof candidate === "string") {
        try {
            candidate = JSON.parse(normaliseModelJson(candidate));
        } catch {
            return null;
        }
    }

    if (!isRecord(candidate) || !Array.isArray(candidate.categories) || candidate.categories.length === 0) {
        return null;
    }
    if (!candidate.categories.every(isSupportImageTriageCategory)) return null;
    if (typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
        return null;
    }
    if (typeof candidate.readable !== "boolean") return null;
    if (candidate.summary !== undefined && typeof candidate.summary !== "string") return null;

    return {
        categories: [...new Set(candidate.categories)],
        confidence: candidate.confidence,
        readable: candidate.readable,
        ...(typeof candidate.summary === "string" ? { summary: candidate.summary.trim().slice(0, 500) } : {}),
    };
}

/**
 * Captions are checked before a photo is sent for visual triage. A clear
 * injury/safety/complaint caption is enough to involve Coach Patrick
 * immediately, which avoids unnecessary image processing and latency.
 */
export function triageSupportImageCaption(caption: string): SupportImageTriage | null {
    const categories: SupportImageTriageCategory[] = [];
    if (/\b(?:injur(?:y|ed)|hurt|bleed(?:ing)?|blood|fractur(?:e|ed)|sprain(?:ed)?|faint(?:ed|ing)?|unconscious|cannot\s+breathe|can't\s+breathe|accident|unsafe|danger(?:ous)?|abuse)\b/i.test(caption)) {
        categories.push("injury");
    }
    if (/\b(?:complaint|complain(?:ing|ed)?|refund|dispute)\b/i.test(caption)) {
        categories.push("complaint");
    }
    return categories.length > 0
        ? { categories, confidence: 1, readable: true, summary: "The caption requires human review." }
        : null;
}

/**
 * Chooses a predictable handling path for an image. Images are handled by the
 * AI only when the model is confident that every detected topic is a routine
 * coaching enquiry. Everything else is escalated so an unreadable or
 * ambiguous injury/complaint image can never be silently treated as routine.
 */
export function decideSupportImageTriage(triage: SupportImageTriage | null): SupportImageTriageDecision {
    if (!triage) return "escalate_immediately";

    const categories = new Set(triage.categories);
    if (triage.categories.some((category) => IMMEDIATE_HUMAN_CATEGORIES.has(category))) {
        return "escalate_immediately";
    }
    if (
        triage.readable
        && triage.confidence >= 0.75
        && !categories.has("uncertain")
        && !categories.has("unreadable")
        && triage.categories.every((category) => ROUTINE_AI_CATEGORIES.has(category))
    ) {
        return "ai_can_answer";
    }

    return "escalate_immediately";
}

/**
 * Revalidates ownership after slow image/model work. The route must never send
 * a stale AI reply if its processing lease was replaced, a newer parent
 * message arrived, or Coach Patrick took over meanwhile.
 */
export function decideSupportImageProcessingContext(input: {
    ownsLease: boolean;
    isLatestParentMessage: boolean;
    status: string;
}): SupportImageProcessingDecision {
    if (!input.ownsLease) return "retry";
    if (!input.isLatestParentMessage) return "superseded";
    if (["escalated", "human_active"].includes(input.status)) return "coach_active";
    return "continue";
}
