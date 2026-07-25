import { NextRequest, NextResponse } from "next/server";
import {
    createAuditedAdminClient,
    getOptionalAuditActor,
    writeAuditEvent,
} from "../../../lib/audit-server";
import {
    downloadSupportTelegramImage,
    extractSupportImageFileId,
} from "../../../lib/support-image-server";

const invalidRequest = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(request: NextRequest) {
    const actor = await getOptionalAuditActor(request);
    if (!actor || actor.role !== "superuser") {
        await writeAuditEvent({
            request,
            actor,
            eventKind: "security",
            category: "support",
            eventType: "support.image.access.denied",
            action: "view_support_image",
            outcome: "denied",
            summary: actor
                ? "A signed-in user without permission attempted to view a parent support image."
                : "An unauthenticated request attempted to view a parent support image.",
            actorSource: actor ? "support_image_api" : "anonymous",
            metadata: { reason: actor ? "insufficient_role" : "authentication_required" },
        });
        return invalidRequest(actor ? "Superuser access required." : "Authentication required.", actor ? 403 : 401);
    }

    const messageId = request.nextUrl.searchParams.get("message_id") || "";
    if (!/^\d+$/.test(messageId)) return invalidRequest("A valid support message is required.");

    const auditedAdmin = createAuditedAdminClient(request, actor, "support_image_api");
    try {
        const { data: message, error } = await auditedAdmin
            .from("support_messages")
            .select("id,conversation_id,sender_type,source_refs")
            .eq("id", Number(messageId))
            .maybeSingle();
        if (error) throw error;
        if (!message || message.sender_type !== "parent") {
            return invalidRequest("Image not found.", 404);
        }

        const fileId = extractSupportImageFileId(message.source_refs);
        if (!fileId) return invalidRequest("Image not found.", 404);

        const image = await downloadSupportTelegramImage(fileId);
        await writeAuditEvent({
            request,
            actor,
            category: "support",
            eventType: "support.image.viewed",
            action: "view_support_image",
            outcome: "success",
            summary: `${actor.user.user_metadata?.name || actor.user.email || "Superuser"} viewed a parent support image`,
            actorSource: "support_image_api",
            targetTable: "support_messages",
            targetRecordId: { id: message.id, conversation_id: message.conversation_id },
            metadata: { image_source: "telegram" },
        });
        return new NextResponse(image.bytes, {
            headers: {
                "Content-Type": image.mimeType,
                "Cache-Control": "private, no-store",
                "Content-Disposition": "inline",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        console.error("Support image GET error:", error);
        return invalidRequest("Could not load this parent image.", 502);
    }
}
