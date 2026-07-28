import assert from "node:assert/strict";
import test from "node:test";
import {
    MAX_SUPPORT_IMAGE_PIXELS,
    MAX_SUPPORT_IMAGE_SIDE,
    MAX_SUPPORT_TELEGRAM_PHOTO_CAPTION_CHARACTERS,
    MAX_SUPPORT_TELEGRAM_IMAGE_BYTES,
    SupportImageDownloadError,
    buildSupportForumPhotoAlertCaption,
    detectSupportImageMimeType,
    downloadSupportTelegramImage,
    extractSupportImageFileId,
    isSafeTelegramFilePath,
    parseSupportImageDimensions,
    publicSupportSourceRefs,
    selectLargestTelegramPhoto,
    supportImageSourceRefs,
    validateSupportImageDimensions,
} from "../app/lib/support-image-server.ts";

function writeUint24LittleEndian(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
}

function writeUint32BigEndian(bytes, offset, value) {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
}

function writeUint32LittleEndian(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
}

function pngHeader(width, height) {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    writeUint32BigEndian(bytes, 8, 13);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    writeUint32BigEndian(bytes, 16, width);
    writeUint32BigEndian(bytes, 20, height);
    bytes.set([8, 2, 0, 0, 0], 24);
    return bytes;
}

function jpegHeader(width, height) {
    return Uint8Array.from([
        0xff, 0xd8,
        0xff, 0xc0, 0x00, 0x11, 0x08,
        (height >>> 8) & 0xff, height & 0xff,
        (width >>> 8) & 0xff, width & 0xff,
        0x03,
        0x01, 0x11, 0x00,
        0x02, 0x11, 0x00,
        0x03, 0x11, 0x00,
        0xff, 0xd9,
    ]);
}

function webpVp8xHeader(width, height) {
    const bytes = new Uint8Array(30);
    bytes.set(new TextEncoder().encode("RIFF"), 0);
    writeUint32LittleEndian(bytes, 4, bytes.length - 8);
    bytes.set(new TextEncoder().encode("WEBPVP8X"), 8);
    writeUint32LittleEndian(bytes, 16, 10);
    writeUint24LittleEndian(bytes, 24, width - 1);
    writeUint24LittleEndian(bytes, 27, height - 1);
    return bytes;
}

test("the largest valid Telegram photo variant is selected deterministically", () => {
    assert.deepEqual(
        selectLargestTelegramPhoto([
            { file_id: "small_photo_id", width: 160, height: 120, file_size: 4_000 },
            { file_id: "", width: 4000, height: 4000, file_size: 10 },
            { file_id: "large_photo_id", file_unique_id: "stable-id", width: 1280, height: 960, file_size: 70_000 },
            { file_id: "same_area_larger_file", width: 960, height: 1280, file_size: 80_000 },
        ]),
        {
            file_id: "same_area_larger_file",
            width: 960,
            height: 1280,
            file_size: 80_000,
        },
    );
    assert.equal(selectLargestTelegramPhoto(null), null);
    assert.equal(selectLargestTelegramPhoto([{ file_id: "x", width: 0, height: 10 }]), null);
});

test("internal Telegram image refs round-trip and never leak as public sources", () => {
    const fileId = "AgACAgUAAxkBAAIBQ2_photo-id_123";
    const internalRefs = supportImageSourceRefs(fileId);

    assert.equal(internalRefs.length, 1);
    assert.match(internalRefs[0], /^patlau-internal:telegram-photo:v1:[A-Za-z0-9_-]+$/);
    assert.equal(extractSupportImageFileId(["Weekend schedule", ...internalRefs]), fileId);
    assert.deepEqual(
        publicSupportSourceRefs([
            "Weekend schedule",
            ...internalRefs,
            " PATLAU-INTERNAL:future:v2:private ",
            "",
            42,
        ]),
        ["Weekend schedule"],
    );

    const other = supportImageSourceRefs("AgACAgUAAxkBAAIBQ2_other-photo");
    assert.equal(extractSupportImageFileId([...internalRefs, ...other]), null);
    assert.equal(
        extractSupportImageFileId(["patlau-internal:telegram-photo:v1:not+base64url"]),
        null,
    );
    assert.throws(() => supportImageSourceRefs("line\nbreak"), TypeError);
});

test("forum photo captions replace the placeholder while preserving secure links", () => {
    const links = [
        "",
        "",
        "Open in PatLau app: https://patlaubmt.vercel.app/open-in-app/chats?conversation=7cda7535-f22d-405e-a996-12f9c30db44d",
        "Open on website: https://patlaubmt.vercel.app/chats?conversation=7cda7535-f22d-405e-a996-12f9c30db44d",
    ].join("\n");
    const caption = buildSupportForumPhotoAlertCaption({
        parentName: "Brendan",
        reason: "A parent image may involve an injury or safety concern.",
        storedMessageContent: "[Photo]\nMy child has a scratch.",
        links,
    });

    assert.match(caption, /Parent: Brendan/);
    assert.match(caption, /Parent caption:\nMy child has a scratch\./);
    assert.doesNotMatch(caption, /Parent sent a photo/i);
    assert.ok(caption.endsWith(links));
    assert.ok(
        Array.from(caption).length
            <= MAX_SUPPORT_TELEGRAM_PHOTO_CAPTION_CHARACTERS,
    );

    const bounded = buildSupportForumPhotoAlertCaption({
        parentName: "Brendan",
        reason: "Review required. ".repeat(200),
        storedMessageContent: `[Photo]\n${"🙂".repeat(1_000)}`,
        links,
    });
    assert.ok(
        Array.from(bounded).length
            <= MAX_SUPPORT_TELEGRAM_PHOTO_CAPTION_CHARACTERS,
    );
    assert.ok(bounded.endsWith(links));
});

test("Telegram file paths are accepted only as safe relative paths", () => {
    assert.equal(isSafeTelegramFilePath("photos/file_42.jpg"), true);
    assert.equal(isSafeTelegramFilePath("documents/folder-name/image.webp"), true);

    for (const path of [
        "",
        "/photos/file.jpg",
        "../secret",
        "photos/../secret",
        "photos//file.jpg",
        "https://example.com/file.jpg",
        "photos\\file.jpg",
        "photos/file.jpg?token=value",
        "photos/%2e%2e/secret",
    ]) {
        assert.equal(isSafeTelegramFilePath(path), false, path);
    }
});

test("supported image formats are detected from magic bytes, not filenames", () => {
    assert.equal(
        detectSupportImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])),
        "image/jpeg",
    );
    assert.equal(
        detectSupportImageMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        "image/png",
    );
    assert.equal(
        detectSupportImageMimeType(Uint8Array.from([
            0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ])),
        "image/webp",
    );
    assert.equal(
        detectSupportImageMimeType(new TextEncoder().encode("<script>alert(1)</script>")),
        null,
    );
});

test("JPEG, PNG and WebP dimensions are parsed and constrained", () => {
    assert.deepEqual(
        parseSupportImageDimensions(jpegHeader(1920, 1080)),
        { width: 1920, height: 1080 },
    );
    assert.deepEqual(
        parseSupportImageDimensions(pngHeader(800, 600)),
        { width: 800, height: 600 },
    );
    assert.deepEqual(
        parseSupportImageDimensions(webpVp8xHeader(640, 480)),
        { width: 640, height: 480 },
    );

    assert.deepEqual(
        validateSupportImageDimensions(pngHeader(5_000, 5_000)),
        { width: 5_000, height: 5_000 },
    );
    assert.equal(MAX_SUPPORT_IMAGE_PIXELS, 25_000_000);
    assert.equal(MAX_SUPPORT_IMAGE_SIDE, 12_000);

    for (const unsafeImage of [
        pngHeader(5_001, 5_000),
        jpegHeader(12_001, 1),
        // A tiny encoded header can still claim a decompression-bomb-sized image.
        pngHeader(12_000, 12_000),
    ]) {
        assert.throws(
            () => validateSupportImageDimensions(unsafeImage),
            (error) => {
                assert.equal(error instanceof SupportImageDownloadError, true);
                assert.equal(error.code, "image_dimensions_too_large");
                return true;
            },
        );
    }

    assert.throws(
        () => validateSupportImageDimensions(
            Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
        ),
        (error) => {
            assert.equal(error.code, "invalid_image_dimensions");
            return true;
        },
    );
});

test("Telegram images download in memory within the 5 MB limit", async () => {
    const previousToken = process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN;
    const originalFetch = globalThis.fetch;
    const secretToken = "TEST_TOKEN_MUST_NOT_LEAK_123";
    process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN = secretToken;
    const calls = [];
    const jpeg = jpegHeader(640, 480);

    globalThis.fetch = async (input, init) => {
        calls.push({ input: String(input), init });
        if (calls.length === 1) {
            return Response.json({
                ok: true,
                result: {
                    file_id: "photo-file-id",
                    file_size: jpeg.byteLength,
                    file_path: "photos/file_42.jpg",
                },
            });
        }
        return new Response(jpeg, {
            status: 200,
            headers: {
                "Content-Type": "image/jpeg",
                "Content-Length": String(jpeg.byteLength),
            },
        });
    };

    try {
        const result = await downloadSupportTelegramImage("photo-file-id", jpeg.byteLength);
        assert.equal(result.mimeType, "image/jpeg");
        assert.equal(result.sizeBytes, jpeg.byteLength);
        assert.equal(result.width, 640);
        assert.equal(result.height, 480);
        assert.deepEqual(result.bytes, jpeg);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].init.method, "POST");
        assert.equal(calls[0].init.redirect, "error");
        assert.equal(calls[0].init.signal instanceof AbortSignal, true);
        assert.equal(calls[1].init.redirect, "error");
        assert.equal(calls[1].init.signal instanceof AbortSignal, true);
    } finally {
        globalThis.fetch = originalFetch;
        if (previousToken === undefined) delete process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN;
        else process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN = previousToken;
    }
});

test("downloaded images with bomb-sized dimensions are rejected", async () => {
    const previousToken = process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN;
    const originalFetch = globalThis.fetch;
    process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN = "TEST_TOKEN";
    const bombHeader = pngHeader(12_000, 12_000);
    let calls = 0;

    globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) {
            return Response.json({
                ok: true,
                result: {
                    file_size: bombHeader.byteLength,
                    file_path: "photos/bomb.png",
                },
            });
        }
        return new Response(bombHeader, {
            status: 200,
            headers: {
                "Content-Type": "image/png",
                "Content-Length": String(bombHeader.byteLength),
            },
        });
    };

    try {
        await assert.rejects(
            downloadSupportTelegramImage("photo-file-id", bombHeader.byteLength),
            (error) => {
                assert.equal(error instanceof SupportImageDownloadError, true);
                assert.equal(error.code, "image_dimensions_too_large");
                return true;
            },
        );
        assert.equal(calls, 2);
    } finally {
        globalThis.fetch = originalFetch;
        if (previousToken === undefined) delete process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN;
        else process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN = previousToken;
    }
});

test("oversized and unsafe Telegram downloads fail without leaking the bot token", async () => {
    const previousToken = process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN;
    const originalFetch = globalThis.fetch;
    const secretToken = "TEST_TOKEN_MUST_NOT_LEAK_456";
    process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN = secretToken;
    let calls = 0;

    try {
        globalThis.fetch = async (input) => {
            calls += 1;
            throw new Error(`network failure at ${String(input)}`);
        };
        await assert.rejects(
            downloadSupportTelegramImage("photo-file-id", MAX_SUPPORT_TELEGRAM_IMAGE_BYTES + 1),
            (error) => {
                assert.equal(error instanceof SupportImageDownloadError, true);
                assert.equal(error.code, "image_too_large");
                assert.doesNotMatch(error.message, new RegExp(secretToken));
                return true;
            },
        );
        assert.equal(calls, 0);

        globalThis.fetch = async () => {
            calls += 1;
            return Response.json({
                ok: true,
                result: {
                    file_size: MAX_SUPPORT_TELEGRAM_IMAGE_BYTES + 1,
                    file_path: "photos/file_42.jpg",
                },
            });
        };
        await assert.rejects(
            downloadSupportTelegramImage("photo-file-id", 100),
            (error) => {
                assert.equal(error.code, "image_too_large");
                assert.doesNotMatch(error.message, new RegExp(secretToken));
                return true;
            },
        );

        await assert.rejects(
            (async () => {
                globalThis.fetch = async (input) => {
                    calls += 1;
                    throw new Error(`network failure at ${String(input)}`);
                };
                return downloadSupportTelegramImage("photo-file-id", 100);
            })(),
            (error) => {
                assert.equal(error instanceof SupportImageDownloadError, true);
                assert.equal(error.code, "get_file_failed");
                assert.doesNotMatch(error.message, new RegExp(secretToken));
                return true;
            },
        );

        globalThis.fetch = async () => {
            calls += 1;
            return Response.json({
                ok: true,
                result: {
                    file_size: 100,
                    file_path: "https://attacker.invalid/photo.jpg",
                },
            });
        };
        await assert.rejects(
            downloadSupportTelegramImage("photo-file-id", 100),
            (error) => {
                assert.equal(error.code, "unsafe_file_path");
                assert.doesNotMatch(error.message, new RegExp(secretToken));
                return true;
            },
        );

        let requestNumber = 0;
        globalThis.fetch = async () => {
            requestNumber += 1;
            if (requestNumber === 1) {
                return Response.json({
                    ok: true,
                    result: {
                        file_size: 100,
                        file_path: "photos/file_42.jpg",
                    },
                });
            }
            return new Response(Uint8Array.from([0xff, 0xd8, 0xff]), {
                status: 200,
                headers: {
                    "Content-Type": "image/jpeg",
                    "Content-Length": String(MAX_SUPPORT_TELEGRAM_IMAGE_BYTES + 1),
                },
            });
        };
        await assert.rejects(
            downloadSupportTelegramImage("photo-file-id", 100),
            (error) => {
                assert.equal(error.code, "image_too_large");
                assert.doesNotMatch(error.message, new RegExp(secretToken));
                return true;
            },
        );
    } finally {
        globalThis.fetch = originalFetch;
        if (previousToken === undefined) delete process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN;
        else process.env.TELEGRAM_PARENT_SUPPORT_BOT_TOKEN = previousToken;
    }
});
