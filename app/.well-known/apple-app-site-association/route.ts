import { NextResponse } from "next/server";
import { buildAppleAppSiteAssociation } from "../../lib/support-links";

export const dynamic = "force-dynamic";

export async function GET() {
    const identifierPrefix = String(
        process.env.APPLE_APP_IDENTIFIER_PREFIX || "",
    ).trim();
    const bundleId = String(process.env.APPLE_APP_BUNDLE_ID || "").trim();

    const association = buildAppleAppSiteAssociation(identifierPrefix, bundleId);
    if (!association) {
        return NextResponse.json(
            { error: "Apple universal links are not configured." },
            {
                status: 503,
                headers: { "Cache-Control": "no-store" },
            },
        );
    }

    return NextResponse.json(
        association,
        {
            headers: {
                "Cache-Control": "public, max-age=3600, s-maxage=3600",
                "Content-Type": "application/json",
            },
        },
    );
}
