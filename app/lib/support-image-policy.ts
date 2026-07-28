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

export const SUPPORT_IMAGE_VISIBLE_FINDINGS = [
    "scratch",
    "bruise",
    "cut",
    "swelling",
    "bleeding",
    "burn",
    "skin_irritation",
    "other_injury",
    "safety_concern",
    "none",
    "unclear",
] as const;

/**
 * Strict Structured Outputs supports only a subset of JSON Schema. Keep this
 * schema in one tested location so unsupported keywords cannot silently break
 * every image request. Duplicate categories are normalised by
 * `parseSupportImageTriage` after the response is received.
 */
export const SUPPORT_IMAGE_TRIAGE_RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
        categories: {
            type: "array",
            minItems: 1,
            items: { type: "string", enum: SUPPORT_IMAGE_TRIAGE_CATEGORIES },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        readable: { type: "boolean" },
        visibleFinding: {
            type: "string",
            enum: SUPPORT_IMAGE_VISIBLE_FINDINGS,
        },
        summary: { type: "string" },
    },
    required: ["categories", "confidence", "readable", "visibleFinding", "summary"],
} as const;

export const SUPPORT_IMAGE_INPUT_DETAIL = "original" as const;
export const DEFAULT_SUPPORT_IMAGE_MODEL = "gpt-5.6-terra";

export function selectSupportImageModel(
    dedicatedImageModel: unknown,
    supportModel: unknown,
) {
    for (const value of [dedicatedImageModel, supportModel]) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return DEFAULT_SUPPORT_IMAGE_MODEL;
}

export type SupportImageTriageCategory = typeof SUPPORT_IMAGE_TRIAGE_CATEGORIES[number];
export type SupportImageVisibleFinding = typeof SUPPORT_IMAGE_VISIBLE_FINDINGS[number];
export type SupportImageTriageDecision =
    | "escalate_immediately"
    | "ai_can_answer"
    | "offer_coach_confirmation";
export type SupportImageProcessingDecision =
    | "continue"
    | "retry"
    | "superseded"
    | "coach_active";
export type SupportImageFailureStage =
    | "telegram_download"
    | "openai_configuration"
    | "openai_request"
    | "openai_response"
    | "openai_output"
    | "unknown";

const SAFE_DIAGNOSTIC_VALUE = /^[a-z0-9_.-]{1,80}$/i;

/**
 * Produces bounded operational metadata for image failures. Callers must pass
 * only codes and response metadata, never an Error message, caption, image,
 * token, request body, or model output.
 */
export function supportImageFailureDiagnostic(input: {
    stage: SupportImageFailureStage;
    code?: unknown;
    status?: unknown;
    param?: unknown;
}) {
    const status = typeof input.status === "number"
        && Number.isInteger(input.status)
        && input.status >= 100
        && input.status <= 599
        ? input.status
        : undefined;
    const safeValue = (value: unknown) =>
        typeof value === "string" && SAFE_DIAGNOSTIC_VALUE.test(value)
            ? value
            : undefined;
    const code = safeValue(input.code);
    const param = safeValue(input.param);

    return {
        stage: input.stage,
        ...(status === undefined ? {} : { status }),
        ...(code ? { code } : {}),
        ...(param ? { param } : {}),
    };
}

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
    visibleFinding: SupportImageVisibleFinding;
    summary?: string;
};

const MEDICAL_OR_SAFETY_CATEGORIES = new Set<SupportImageTriageCategory>([
    "injury",
    "medical",
    "safety",
    "abuse",
    "urgent",
]);
const COMPLAINT_CATEGORIES = new Set<SupportImageTriageCategory>([
    "complaint",
    "refund",
    "dispute",
]);
const FINDING_DESCRIPTION: Partial<Record<SupportImageVisibleFinding, string>> = {
    scratch: "what looks like a scratch",
    bruise: "what looks like a bruise",
    cut: "what looks like a cut",
    swelling: "what looks like some swelling",
    bleeding: "what looks like some bleeding",
    burn: "what may be a burn",
    skin_irritation: "what looks like skin irritation",
    other_injury: "a visible injury",
    safety_concern: "a possible safety concern",
};

/**
 * Builds deterministic parent-facing handoff copy from validated categories.
 * Free-form model summaries are deliberately ignored because they may contain
 * private details or an unreliable description of the photo.
 */
export function supportImageEscalationMessage(
    triage: SupportImageTriage | null,
    analysisFailed = false,
) {
    const categories = triage?.categories ?? [];

    if (analysisFailed || !triage) {
        return "I'm sorry, but I couldn't safely determine what this photo shows.\n\nThe AI assistant is now paused. Coach Patrick will take over the conversation from here. Please wait for his reply.";
    }
    if (categories.some((category) => MEDICAL_OR_SAFETY_CATEGORIES.has(category))) {
        const finding = FINDING_DESCRIPTION[triage.visibleFinding];
        const acknowledgement = finding
            ? `I can see ${finding} in the photo.`
            : "The photo may involve an injury or safety concern.";
        return `I'm sorry this happened. ${acknowledgement}\n\nThe AI assistant is now paused. Coach Patrick will take over the conversation from here. Please wait for his reply.\n\nIf anyone may need urgent medical attention or is in immediate danger, please seek appropriate medical or emergency help now rather than waiting for a chat reply.`;
    }
    if (categories.some((category) => COMPLAINT_CATEGORIES.has(category))) {
        return "Thank you for sharing this.\n\nThe AI assistant is now paused. Coach Patrick will take over the conversation from here. Please wait for his reply. You can continue adding relevant details in this chat.";
    }
    return "The AI assistant is now paused. Coach Patrick will take over the conversation from here. Please wait for his reply.";
}

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

const VISIBLE_FINDING_SET = new Set<string>(SUPPORT_IMAGE_VISIBLE_FINDINGS);

function isSupportImageVisibleFinding(value: unknown): value is SupportImageVisibleFinding {
    return typeof value === "string" && VISIBLE_FINDING_SET.has(value);
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
    if (!isSupportImageVisibleFinding(candidate.visibleFinding)) return null;
    if (candidate.summary !== undefined && typeof candidate.summary !== "string") return null;

    return {
        categories: [...new Set(candidate.categories)],
        confidence: candidate.confidence,
        readable: candidate.readable,
        visibleFinding: candidate.visibleFinding,
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
        ? {
            categories,
            confidence: 1,
            readable: true,
            visibleFinding: "unclear",
            summary: "The caption requires human review.",
        }
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
