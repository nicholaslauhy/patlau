const INTERNAL_SOURCE_REF_ROOT = "patlau-internal:";
const TELEGRAM_PHOTO_SOURCE_REF_PREFIX = `${INTERNAL_SOURCE_REF_ROOT}telegram-photo:v1:`;

export const MAX_SUPPORT_TELEGRAM_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_SUPPORT_IMAGE_PIXELS = 25_000_000;
export const MAX_SUPPORT_IMAGE_SIDE = 12_000;
export const MAX_SUPPORT_TELEGRAM_PHOTO_CAPTION_CHARACTERS = 1024;

const MAX_TELEGRAM_FILE_ID_LENGTH = 512;
const MAX_TELEGRAM_FILE_PATH_LENGTH = 1024;
const GET_FILE_TIMEOUT_MS = 8_000;
const DOWNLOAD_TIMEOUT_MS = 12_000;

export type SupportImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export type TelegramPhotoSize = {
    file_id: string;
    file_unique_id?: string;
    width: number;
    height: number;
    file_size?: number;
};

export type DownloadedSupportTelegramImage = {
    bytes: Uint8Array;
    mimeType: SupportImageMimeType;
    sizeBytes: number;
    width: number;
    height: number;
};

export type SupportImageDimensions = {
    width: number;
    height: number;
};

export class SupportImageDownloadError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = "SupportImageDownloadError";
        this.code = code;
    }
}

function validTelegramFileId(value: unknown): value is string {
    return typeof value === "string"
        && value.length > 0
        && value.length <= MAX_TELEGRAM_FILE_ID_LENGTH
        && /^[\x21-\x7e]+$/.test(value);
}

export function isValidSupportTelegramImageFileId(
    value: unknown,
): value is string {
    return validTelegramFileId(value);
}

function optionalPositiveInteger(value: unknown) {
    return value === undefined
        || (Number.isSafeInteger(value) && Number(value) > 0);
}

function normalisePhotoSize(value: unknown): TelegramPhotoSize | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (
        !validTelegramFileId(candidate.file_id)
        || !Number.isSafeInteger(candidate.width)
        || Number(candidate.width) <= 0
        || !Number.isSafeInteger(candidate.height)
        || Number(candidate.height) <= 0
        || !optionalPositiveInteger(candidate.file_size)
    ) {
        return null;
    }

    const fileUniqueId = typeof candidate.file_unique_id === "string"
        && candidate.file_unique_id.length > 0
        && candidate.file_unique_id.length <= MAX_TELEGRAM_FILE_ID_LENGTH
        ? candidate.file_unique_id
        : undefined;

    return {
        file_id: candidate.file_id,
        ...(fileUniqueId ? { file_unique_id: fileUniqueId } : {}),
        width: Number(candidate.width),
        height: Number(candidate.height),
        ...(candidate.file_size === undefined
            ? {}
            : { file_size: Number(candidate.file_size) }),
    };
}

/**
 * Telegram supplies several sizes for the same photo. Select only the
 * highest-resolution valid variant, using byte size as a deterministic
 * tiebreaker.
 */
export function selectLargestTelegramPhoto(value: unknown): TelegramPhotoSize | null {
    if (!Array.isArray(value)) return null;

    let largest: TelegramPhotoSize | null = null;
    let largestArea = -1;
    let largestBytes = -1;

    for (const entry of value) {
        const candidate = normalisePhotoSize(entry);
        if (!candidate) continue;
        const area = candidate.width * candidate.height;
        const bytes = candidate.file_size || 0;
        if (area > largestArea || (area === largestArea && bytes > largestBytes)) {
            largest = candidate;
            largestArea = area;
            largestBytes = bytes;
        }
    }

    return largest;
}

function encodeFileId(fileId: string) {
    return Buffer.from(fileId, "utf8").toString("base64url");
}

function decodeFileId(encoded: string) {
    if (!encoded || encoded.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
        return null;
    }
    try {
        const decoded = Buffer.from(encoded, "base64url").toString("utf8");
        if (!validTelegramFileId(decoded) || encodeFileId(decoded) !== encoded) {
            return null;
        }
        return decoded;
    } catch {
        return null;
    }
}

/**
 * Stores Telegram's opaque file ID inside the existing source_refs column.
 * The encoded value is internal metadata, not an access URL or public source.
 */
export function supportImageSourceRefs(fileId: string) {
    if (!validTelegramFileId(fileId)) {
        throw new TypeError("A valid Telegram file ID is required.");
    }
    return [`${TELEGRAM_PHOTO_SOURCE_REF_PREFIX}${encodeFileId(fileId)}`];
}

/**
 * Returns one unambiguous Telegram photo file ID. Malformed or conflicting
 * internal references fail closed.
 */
export function extractSupportImageFileId(refs: unknown): string | null {
    if (!Array.isArray(refs)) return null;

    let extracted: string | null = null;
    for (const value of refs) {
        if (typeof value !== "string") continue;
        const ref = value.trim();
        if (!ref.startsWith(TELEGRAM_PHOTO_SOURCE_REF_PREFIX)) continue;
        const decoded = decodeFileId(ref.slice(TELEGRAM_PHOTO_SOURCE_REF_PREFIX.length));
        if (!decoded) return null;
        if (extracted && extracted !== decoded) return null;
        extracted = decoded;
    }
    return extracted;
}

function truncateUnicode(value: string, maximum: number) {
    return Array.from(value).slice(0, Math.max(0, maximum)).join("");
}

function storedSupportPhotoCaption(content: string) {
    const prefix = "[Photo]\n";
    return content.startsWith(prefix)
        ? truncateUnicode(content.slice(prefix.length).trim(), 220)
        : "";
}

export function buildSupportForumPhotoAlertCaption(input: {
    parentName: string;
    reason: string;
    storedMessageContent: string;
    links: string;
}) {
    const parentName = truncateUnicode(input.parentName.trim() || "Parent", 80);
    const reason = truncateUnicode(input.reason.trim(), 320);
    const parentCaption = storedSupportPhotoCaption(input.storedMessageContent);
    const prefix = [
        "Parent chat needs attention",
        `Parent: ${parentName}`,
        `Reason: ${reason}`,
        ...(parentCaption ? [`Parent caption:\n${parentCaption}`] : []),
    ].join("\n\n");
    const suffix = `\n\nType a normal message in this topic to answer this parent. They receive only your message exactly as written.${input.links}`;
    const availablePrefixLength =
        MAX_SUPPORT_TELEGRAM_PHOTO_CAPTION_CHARACTERS
        - Array.from(suffix).length;
    return `${truncateUnicode(prefix, availablePrefixLength).trimEnd()}${suffix}`;
}

/**
 * Internal references must never be displayed as AI knowledge sources or
 * returned to an untrusted client. Filtering is deliberately broader than the
 * current photo format so future or malformed patlau-internal refs stay hidden.
 */
export function publicSupportSourceRefs(refs: unknown) {
    if (!Array.isArray(refs)) return [];
    return refs.flatMap((value) => {
        if (typeof value !== "string") return [];
        const ref = value.trim();
        if (!ref || ref.toLocaleLowerCase().startsWith(INTERNAL_SOURCE_REF_ROOT)) {
            return [];
        }
        return [ref];
    });
}

export function isSafeTelegramFilePath(value: unknown): value is string {
    if (
        typeof value !== "string"
        || value.length === 0
        || value.length > MAX_TELEGRAM_FILE_PATH_LENGTH
        || value.startsWith("/")
        || value.includes("\\")
        || value.includes("?")
        || value.includes("#")
        || value.includes(":")
        || value.includes("%")
        || !/^[A-Za-z0-9._/-]+$/.test(value)
    ) {
        return false;
    }

    const segments = value.split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function asBytes(value: Uint8Array | ArrayBuffer) {
    return value instanceof Uint8Array ? value : new Uint8Array(value);
}

export function detectSupportImageMimeType(
    value: Uint8Array | ArrayBuffer,
): SupportImageMimeType | null {
    const bytes = asBytes(value);
    if (
        bytes.length >= 3
        && bytes[0] === 0xff
        && bytes[1] === 0xd8
        && bytes[2] === 0xff
    ) {
        return "image/jpeg";
    }
    if (
        bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a
    ) {
        return "image/png";
    }
    if (
        bytes.length >= 12
        && bytes[0] === 0x52
        && bytes[1] === 0x49
        && bytes[2] === 0x46
        && bytes[3] === 0x46
        && bytes[8] === 0x57
        && bytes[9] === 0x45
        && bytes[10] === 0x42
        && bytes[11] === 0x50
    ) {
        return "image/webp";
    }
    return null;
}

function readUint16BigEndian(bytes: Uint8Array, offset: number) {
    if (offset < 0 || offset + 2 > bytes.length) return null;
    return (bytes[offset] * 0x100) + bytes[offset + 1];
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number) {
    if (offset < 0 || offset + 2 > bytes.length) return null;
    return bytes[offset] + (bytes[offset + 1] * 0x100);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number) {
    if (offset < 0 || offset + 3 > bytes.length) return null;
    return bytes[offset] + (bytes[offset + 1] * 0x100) + (bytes[offset + 2] * 0x10000);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number) {
    if (offset < 0 || offset + 4 > bytes.length) return null;
    return (bytes[offset] * 0x1000000)
        + (bytes[offset + 1] * 0x10000)
        + (bytes[offset + 2] * 0x100)
        + bytes[offset + 3];
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number) {
    if (offset < 0 || offset + 4 > bytes.length) return null;
    return bytes[offset]
        + (bytes[offset + 1] * 0x100)
        + (bytes[offset + 2] * 0x10000)
        + (bytes[offset + 3] * 0x1000000);
}

function positiveDimensions(width: number | null, height: number | null) {
    if (
        width === null
        || height === null
        || !Number.isSafeInteger(width)
        || !Number.isSafeInteger(height)
        || width <= 0
        || height <= 0
    ) {
        return null;
    }
    return { width, height };
}

function parsePngDimensions(bytes: Uint8Array) {
    if (
        bytes.length < 33
        || readUint32BigEndian(bytes, 8) !== 13
        || bytes[12] !== 0x49
        || bytes[13] !== 0x48
        || bytes[14] !== 0x44
        || bytes[15] !== 0x52
    ) {
        return null;
    }
    return positiveDimensions(
        readUint32BigEndian(bytes, 16),
        readUint32BigEndian(bytes, 20),
    );
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
]);

function parseJpegDimensions(bytes: Uint8Array) {
    if (
        bytes.length < 4
        || bytes[0] !== 0xff
        || bytes[1] !== 0xd8
    ) {
        return null;
    }

    let offset = 2;
    while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) return null;
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        if (offset >= bytes.length) return null;

        const marker = bytes[offset];
        offset += 1;
        if (marker === 0x00) continue;
        if (
            marker === 0x01
            || marker === 0xd8
            || (marker >= 0xd0 && marker <= 0xd7)
        ) {
            continue;
        }
        if (marker === 0xd9 || marker === 0xda) return null;

        const segmentLength = readUint16BigEndian(bytes, offset);
        if (
            segmentLength === null
            || segmentLength < 2
            || offset + segmentLength > bytes.length
        ) {
            return null;
        }
        if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
            if (segmentLength < 8) return null;
            const componentCount = bytes[offset + 7];
            if (
                componentCount <= 0
                || segmentLength < 8 + (componentCount * 3)
            ) {
                return null;
            }
            return positiveDimensions(
                readUint16BigEndian(bytes, offset + 5),
                readUint16BigEndian(bytes, offset + 3),
            );
        }
        offset += segmentLength;
    }
    return null;
}

function chunkName(bytes: Uint8Array, offset: number) {
    if (offset < 0 || offset + 4 > bytes.length) return "";
    return String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    );
}

function parseWebpDimensions(bytes: Uint8Array) {
    if (
        bytes.length < 20
        || chunkName(bytes, 0) !== "RIFF"
        || chunkName(bytes, 8) !== "WEBP"
    ) {
        return null;
    }

    const riffSize = readUint32LittleEndian(bytes, 4);
    if (
        riffSize === null
        || riffSize < 12
        || riffSize + 8 > bytes.length
    ) {
        return null;
    }
    const riffEnd = riffSize + 8;
    let offset = 12;
    while (offset + 8 <= riffEnd) {
        const name = chunkName(bytes, offset);
        const chunkSize = readUint32LittleEndian(bytes, offset + 4);
        if (chunkSize === null) return null;
        const dataOffset = offset + 8;
        const dataEnd = dataOffset + chunkSize;
        if (dataEnd > riffEnd) return null;

        if (name === "VP8X") {
            if (chunkSize < 10) return null;
            const widthMinusOne = readUint24LittleEndian(bytes, dataOffset + 4);
            const heightMinusOne = readUint24LittleEndian(bytes, dataOffset + 7);
            return positiveDimensions(
                widthMinusOne === null ? null : widthMinusOne + 1,
                heightMinusOne === null ? null : heightMinusOne + 1,
            );
        }
        if (name === "VP8L") {
            if (chunkSize < 5 || bytes[dataOffset] !== 0x2f) return null;
            const packed = readUint32LittleEndian(bytes, dataOffset + 1);
            if (packed === null) return null;
            return positiveDimensions(
                (packed & 0x3fff) + 1,
                ((packed >>> 14) & 0x3fff) + 1,
            );
        }
        if (name === "VP8 ") {
            if (
                chunkSize < 10
                || bytes[dataOffset + 3] !== 0x9d
                || bytes[dataOffset + 4] !== 0x01
                || bytes[dataOffset + 5] !== 0x2a
            ) {
                return null;
            }
            const rawWidth = readUint16LittleEndian(bytes, dataOffset + 6);
            const rawHeight = readUint16LittleEndian(bytes, dataOffset + 8);
            return positiveDimensions(
                rawWidth === null ? null : rawWidth & 0x3fff,
                rawHeight === null ? null : rawHeight & 0x3fff,
            );
        }

        offset = dataEnd + (chunkSize % 2);
    }
    return null;
}

export function parseSupportImageDimensions(
    value: Uint8Array | ArrayBuffer,
    mimeType?: SupportImageMimeType,
): SupportImageDimensions | null {
    const bytes = asBytes(value);
    const detectedType = detectSupportImageMimeType(bytes);
    if (!detectedType || (mimeType && detectedType !== mimeType)) return null;

    if (detectedType === "image/png") return parsePngDimensions(bytes);
    if (detectedType === "image/jpeg") return parseJpegDimensions(bytes);
    return parseWebpDimensions(bytes);
}

export function validateSupportImageDimensions(
    value: Uint8Array | ArrayBuffer,
    mimeType?: SupportImageMimeType,
) {
    const dimensions = parseSupportImageDimensions(value, mimeType);
    if (!dimensions) {
        throw new SupportImageDownloadError(
            "invalid_image_dimensions",
            "Telegram returned image dimensions that could not be verified.",
        );
    }
    if (
        dimensions.width > MAX_SUPPORT_IMAGE_SIDE
        || dimensions.height > MAX_SUPPORT_IMAGE_SIDE
        || dimensions.width * dimensions.height > MAX_SUPPORT_IMAGE_PIXELS
    ) {
        throw new SupportImageDownloadError(
            "image_dimensions_too_large",
            "The Telegram image dimensions exceed the safe limit.",
        );
    }
    return dimensions;
}

function validatedSize(value: unknown, code: string) {
    if (value === undefined || value === null) return null;
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        throw new SupportImageDownloadError(code, "Telegram supplied an invalid image size.");
    }
    const size = Number(value);
    if (size > MAX_SUPPORT_TELEGRAM_IMAGE_BYTES) {
        throw new SupportImageDownloadError("image_too_large", "The Telegram image exceeds the 5 MB limit.");
    }
    return size;
}

async function boundedResponseBytes(response: Response) {
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader !== null) {
        if (!/^\d+$/.test(contentLengthHeader)) {
            throw new SupportImageDownloadError(
                "invalid_content_length",
                "Telegram returned an invalid image length.",
            );
        }
        validatedSize(Number(contentLengthHeader), "invalid_content_length");
    }
    if (!response.body) {
        throw new SupportImageDownloadError("empty_download", "Telegram returned an empty image.");
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value?.byteLength) continue;
            total += value.byteLength;
            if (total > MAX_SUPPORT_TELEGRAM_IMAGE_BYTES) {
                await reader.cancel();
                throw new SupportImageDownloadError(
                    "image_too_large",
                    "The Telegram image exceeds the 5 MB limit.",
                );
            }
            chunks.push(value);
        }
    } catch (error) {
        if (error instanceof SupportImageDownloadError) throw error;
        throw new SupportImageDownloadError(
            "download_failed",
            "Telegram could not provide the image.",
        );
    } finally {
        reader.releaseLock();
    }

    if (total === 0) {
        throw new SupportImageDownloadError("empty_download", "Telegram returned an empty image.");
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

/**
 * Downloads a Telegram-hosted photo into short-lived server memory. The bot
 * token is used only in fixed Telegram URLs and never appears in returned data
 * or thrown error messages.
 */
export async function downloadSupportTelegramImage(
    fileId: string,
    declaredSize?: number,
): Promise<DownloadedSupportTelegramImage> {
    if (typeof window !== "undefined") {
        throw new SupportImageDownloadError(
            "server_only",
            "Telegram images can only be retrieved by the server.",
        );
    }
    if (!validTelegramFileId(fileId)) {
        throw new SupportImageDownloadError("invalid_file_id", "Telegram supplied an invalid image identifier.");
    }
    validatedSize(declaredSize, "invalid_declared_size");

    const token = process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN;
    if (!token) {
        throw new SupportImageDownloadError(
            "missing_configuration",
            "Telegram image retrieval is not configured.",
        );
    }

    let getFileResponse: Response;
    try {
        getFileResponse = await fetch(
            `https://api.telegram.org/bot${token}/getFile`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file_id: fileId }),
                signal: AbortSignal.timeout(GET_FILE_TIMEOUT_MS),
                redirect: "error",
                cache: "no-store",
            },
        );
    } catch {
        throw new SupportImageDownloadError(
            "get_file_failed",
            "Telegram could not prepare the image.",
        );
    }

    let fileResult: Record<string, unknown> | null = null;
    try {
        const payload = await getFileResponse.json() as {
            ok?: boolean;
            result?: Record<string, unknown>;
        };
        if (getFileResponse.ok && payload.ok && payload.result) {
            fileResult = payload.result;
        }
    } catch {
        // Replaced below with a stable error that cannot disclose the bot URL.
    }
    if (!fileResult) {
        throw new SupportImageDownloadError(
            "get_file_rejected",
            "Telegram could not prepare the image.",
        );
    }

    validatedSize(fileResult.file_size, "invalid_telegram_file_size");
    const filePath = fileResult.file_path;
    if (!isSafeTelegramFilePath(filePath)) {
        throw new SupportImageDownloadError(
            "unsafe_file_path",
            "Telegram returned an invalid image path.",
        );
    }

    let imageResponse: Response;
    try {
        imageResponse = await fetch(
            `https://api.telegram.org/file/bot${token}/${filePath}`,
            {
                method: "GET",
                signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
                redirect: "error",
                cache: "no-store",
            },
        );
    } catch {
        throw new SupportImageDownloadError(
            "download_failed",
            "Telegram could not provide the image.",
        );
    }
    if (!imageResponse.ok) {
        throw new SupportImageDownloadError(
            "download_rejected",
            "Telegram could not provide the image.",
        );
    }

    const bytes = await boundedResponseBytes(imageResponse);
    const mimeType = detectSupportImageMimeType(bytes);
    if (!mimeType) {
        throw new SupportImageDownloadError(
            "unsupported_image",
            "Telegram returned an unsupported image format.",
        );
    }

    const responseMimeType = imageResponse.headers.get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLocaleLowerCase();
    if (
        responseMimeType?.startsWith("image/")
        && responseMimeType !== mimeType
    ) {
        throw new SupportImageDownloadError(
            "image_type_mismatch",
            "Telegram returned inconsistent image data.",
        );
    }

    const dimensions = validateSupportImageDimensions(bytes, mimeType);
    return {
        bytes,
        mimeType,
        sizeBytes: bytes.byteLength,
        width: dimensions.width,
        height: dimensions.height,
    };
}
