import { NextRequest, NextResponse } from "next/server";

const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
    const conversationId = request.nextUrl.searchParams.get("conversation")?.trim() || "";
    const webFallback = request.nextUrl.clone();
    webFallback.pathname = "/chats";
    webFallback.search = "";
    if (CONVERSATION_ID_PATTERN.test(conversationId)) {
        webFallback.searchParams.set("conversation", conversationId);
    }

    const response = NextResponse.redirect(webFallback, 307);
    response.headers.set("Cache-Control", "no-store");
    return response;
}
