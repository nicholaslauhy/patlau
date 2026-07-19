import { createClient, type User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const bucketName = "avatars";
const maximumFileSize = 5 * 1024 * 1024;
const allowedTypes: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};

const authClient = createClient(supabaseUrl, anonKey);
const adminClient = createClient(supabaseUrl, serviceRoleKey);

async function getCaller(request: NextRequest): Promise<User | null> {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return null;
    const token = authorization.slice("Bearer ".length);
    const { data, error } = await authClient.auth.getUser(token);
    return error ? null : data.user;
}

async function ensureAvatarBucket() {
    const { data } = await adminClient.storage.getBucket(bucketName);
    if (data) return;

    const { error } = await adminClient.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: maximumFileSize,
        allowedMimeTypes: Object.keys(allowedTypes),
    });
    if (error && !error.message.toLowerCase().includes("already exists")) throw error;
}

export async function POST(request: NextRequest) {
    let uploadedPath = "";

    try {
        const caller = await getCaller(request);
        if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const formData = await request.formData();
        const photo = formData.get("photo");
        if (!(photo instanceof File)) {
            return NextResponse.json({ error: "A profile photo is required." }, { status: 400 });
        }
        if (!allowedTypes[photo.type]) {
            return NextResponse.json({ error: "Use a JPG, PNG, or WebP image." }, { status: 415 });
        }
        if (photo.size > maximumFileSize) {
            return NextResponse.json({ error: "Profile photos must be 5 MB or smaller." }, { status: 413 });
        }

        await ensureAvatarBucket();
        uploadedPath = `${caller.id}/avatar-${Date.now()}.${allowedTypes[photo.type]}`;
        const bytes = new Uint8Array(await photo.arrayBuffer());
        const { error: uploadError } = await adminClient.storage
            .from(bucketName)
            .upload(uploadedPath, bytes, { contentType: photo.type, upsert: false });
        if (uploadError) throw uploadError;

        const { data: publicData } = adminClient.storage.from(bucketName).getPublicUrl(uploadedPath);
        const avatarUrl = publicData.publicUrl;
        const previousPath = caller.user_metadata?.avatar_path as string | undefined;
        const { error: metadataError } = await adminClient.auth.admin.updateUserById(caller.id, {
            user_metadata: {
                ...(caller.user_metadata || {}),
                avatar_url: avatarUrl,
                avatar_path: uploadedPath,
            },
        });
        if (metadataError) throw metadataError;

        if (previousPath && previousPath !== uploadedPath) {
            const { error: cleanupError } = await adminClient.storage.from(bucketName).remove([previousPath]);
            if (cleanupError) console.warn("Unable to remove previous profile photo:", cleanupError.message);
        }

        return NextResponse.json({ avatarUrl });
    } catch (error) {
        if (uploadedPath) await adminClient.storage.from(bucketName).remove([uploadedPath]);
        console.error("Profile photo upload failed:", error);
        return NextResponse.json({ error: "Failed to save the profile photo." }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const caller = await getCaller(request);
        if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const previousPath = caller.user_metadata?.avatar_path as string | undefined;
        const { error: metadataError } = await adminClient.auth.admin.updateUserById(caller.id, {
            user_metadata: {
                ...(caller.user_metadata || {}),
                avatar_url: null,
                avatar_path: null,
            },
        });
        if (metadataError) throw metadataError;

        if (previousPath) {
            const { error: removalError } = await adminClient.storage.from(bucketName).remove([previousPath]);
            if (removalError) console.warn("Unable to remove profile photo file:", removalError.message);
        }

        return NextResponse.json({ avatarUrl: null });
    } catch (error) {
        console.error("Profile photo removal failed:", error);
        return NextResponse.json({ error: "Failed to remove the profile photo." }, { status: 500 });
    }
}
