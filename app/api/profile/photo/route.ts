import { createClient, type User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { safeAuditError, writeAuditEvent } from "../../../lib/audit-server";

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
    let caller: User | null = null;

    try {
        caller = await getCaller(request);
        if (!caller) {
            await writeAuditEvent({
                request,
                actor: null,
                eventKind: "security",
                category: "profiles",
                eventType: "profile.photo_upload",
                action: "upload_profile_photo",
                outcome: "denied",
                summary: "An unauthorized profile photo upload was denied.",
                actorSource: "anonymous",
                targetTable: "auth.users",
            });
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const formData = await request.formData();
        const photo = formData.get("photo");
        if (!(photo instanceof File)) {
            await writeAuditEvent({
                request,
                actor: { user: caller },
                category: "profiles",
                eventType: "profile.photo_upload",
                action: "upload_profile_photo",
                outcome: "failure",
                summary: "A profile photo upload failed because no photo was provided.",
                targetTable: "auth.users",
                targetRecordId: { user_id: caller.id },
                targetLabel: caller.user_metadata?.name || caller.email || "Current account",
                metadata: { reason: "missing_photo" },
            });
            return NextResponse.json({ error: "A profile photo is required." }, { status: 400 });
        }
        if (!allowedTypes[photo.type]) {
            await writeAuditEvent({
                request,
                actor: { user: caller },
                category: "profiles",
                eventType: "profile.photo_upload",
                action: "upload_profile_photo",
                outcome: "failure",
                summary: "A profile photo upload used an unsupported file type.",
                targetTable: "auth.users",
                targetRecordId: { user_id: caller.id },
                targetLabel: caller.user_metadata?.name || caller.email || "Current account",
                metadata: { reason: "unsupported_file_type", file_type: photo.type },
            });
            return NextResponse.json({ error: "Use a JPG, PNG, or WebP image." }, { status: 415 });
        }
        if (photo.size > maximumFileSize) {
            await writeAuditEvent({
                request,
                actor: { user: caller },
                category: "profiles",
                eventType: "profile.photo_upload",
                action: "upload_profile_photo",
                outcome: "failure",
                summary: "A profile photo upload exceeded the file-size limit.",
                targetTable: "auth.users",
                targetRecordId: { user_id: caller.id },
                targetLabel: caller.user_metadata?.name || caller.email || "Current account",
                metadata: { reason: "file_too_large", file_size_bytes: photo.size },
            });
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

        let previousPhotoCleanupFailed = false;
        if (previousPath && previousPath !== uploadedPath) {
            const { error: cleanupError } = await adminClient.storage.from(bucketName).remove([previousPath]);
            if (cleanupError) {
                previousPhotoCleanupFailed = true;
                console.warn("Unable to remove previous profile photo:", cleanupError.message);
            }
        }

        await writeAuditEvent({
            request,
            actor: { user: caller },
            category: "profiles",
            eventType: "profile.photo_upload",
            action: "upload_profile_photo",
            outcome: previousPhotoCleanupFailed ? "warning" : "success",
            summary: previousPhotoCleanupFailed
                ? "Updated the profile photo, but the previous file could not be removed."
                : "Updated the profile photo.",
            targetTable: "auth.users",
            targetRecordId: { user_id: caller.id },
            targetLabel: caller.user_metadata?.name || caller.email || "Current account",
            changedFields: ["profile_photo"],
            oldValues: { had_profile_photo: Boolean(previousPath) },
            newValues: {
                has_profile_photo: true,
                file_type: photo.type,
                file_size_bytes: photo.size,
            },
            metadata: { previous_photo_cleanup_failed: previousPhotoCleanupFailed },
        });

        return NextResponse.json({ avatarUrl });
    } catch (error) {
        if (uploadedPath) await adminClient.storage.from(bucketName).remove([uploadedPath]);
        console.error("Profile photo upload failed:", safeAuditError(error));
        await writeAuditEvent({
            request,
            actor: caller ? { user: caller } : null,
            category: "profiles",
            eventType: "profile.photo_upload",
            action: "upload_profile_photo",
            outcome: "failure",
            summary: "A profile photo upload failed unexpectedly.",
            actorSource: caller ? "authenticated" : "anonymous",
            targetTable: "auth.users",
            targetRecordId: caller ? { user_id: caller.id } : null,
            targetLabel: caller?.user_metadata?.name || caller?.email || null,
            metadata: { reason: "unexpected_error" },
        });
        return NextResponse.json({ error: "Failed to save the profile photo." }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    let caller: User | null = null;

    try {
        caller = await getCaller(request);
        if (!caller) {
            await writeAuditEvent({
                request,
                actor: null,
                eventKind: "security",
                category: "profiles",
                eventType: "profile.photo_remove",
                action: "remove_profile_photo",
                outcome: "denied",
                summary: "An unauthorized profile photo removal was denied.",
                actorSource: "anonymous",
                targetTable: "auth.users",
            });
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const previousPath = caller.user_metadata?.avatar_path as string | undefined;
        const { error: metadataError } = await adminClient.auth.admin.updateUserById(caller.id, {
            user_metadata: {
                ...(caller.user_metadata || {}),
                avatar_url: null,
                avatar_path: null,
            },
        });
        if (metadataError) throw metadataError;

        let photoRemovalFailed = false;
        if (previousPath) {
            const { error: removalError } = await adminClient.storage.from(bucketName).remove([previousPath]);
            if (removalError) {
                photoRemovalFailed = true;
                console.warn("Unable to remove profile photo file:", removalError.message);
            }
        }

        await writeAuditEvent({
            request,
            actor: { user: caller },
            category: "profiles",
            eventType: "profile.photo_remove",
            action: "remove_profile_photo",
            outcome: photoRemovalFailed ? "warning" : "success",
            summary: photoRemovalFailed
                ? "Removed the profile photo from the account, but its stored file could not be deleted."
                : previousPath
                    ? "Removed the profile photo."
                    : "Confirmed that the account has no profile photo.",
            targetTable: "auth.users",
            targetRecordId: { user_id: caller.id },
            targetLabel: caller.user_metadata?.name || caller.email || "Current account",
            changedFields: previousPath ? ["profile_photo"] : [],
            oldValues: { had_profile_photo: Boolean(previousPath) },
            newValues: { has_profile_photo: false },
            metadata: { stored_file_removal_failed: photoRemovalFailed },
        });

        return NextResponse.json({ avatarUrl: null });
    } catch (error) {
        console.error("Profile photo removal failed:", safeAuditError(error));
        await writeAuditEvent({
            request,
            actor: caller ? { user: caller } : null,
            category: "profiles",
            eventType: "profile.photo_remove",
            action: "remove_profile_photo",
            outcome: "failure",
            summary: "A profile photo removal failed unexpectedly.",
            actorSource: caller ? "authenticated" : "anonymous",
            targetTable: "auth.users",
            targetRecordId: caller ? { user_id: caller.id } : null,
            targetLabel: caller?.user_metadata?.name || caller?.email || null,
            metadata: { reason: "unexpected_error" },
        });
        return NextResponse.json({ error: "Failed to remove the profile photo." }, { status: 500 });
    }
}
