"use client";

import { useEffect, useRef, useState } from "react";

interface ProfilePhotoEditorProps {
    file: File;
    saving: boolean;
    error?: string;
    onCancel: () => void;
    onSave: (blob: Blob) => void;
}

const CANVAS_SIZE = 480;

export default function ProfilePhotoEditor({ file, saving, error, onCancel, onSave }: ProfilePhotoEditorProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const dragRef = useRef<{ x: number; y: number } | null>(null);
    const [objectUrl, setObjectUrl] = useState("");
    const [ready, setReady] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });

    useEffect(() => {
        const url = URL.createObjectURL(file);
        setObjectUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    useEffect(() => {
        if (!objectUrl) return;
        const image = new Image();
        image.onload = () => {
            imageRef.current = image;
            setReady(true);
        };
        image.src = objectUrl;
    }, [objectUrl]);

    const getGeometry = (nextZoom = zoom) => {
        const image = imageRef.current;
        if (!image) return null;
        const baseScale = Math.max(CANVAS_SIZE / image.naturalWidth, CANVAS_SIZE / image.naturalHeight);
        const scale = baseScale * nextZoom;
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        return {
            width,
            height,
            maxX: Math.max(0, (width - CANVAS_SIZE) / 2),
            maxY: Math.max(0, (height - CANVAS_SIZE) / 2),
        };
    };

    const clampOffset = (value: { x: number; y: number }, nextZoom = zoom) => {
        const geometry = getGeometry(nextZoom);
        if (!geometry) return value;
        return {
            x: Math.max(-geometry.maxX, Math.min(geometry.maxX, value.x)),
            y: Math.max(-geometry.maxY, Math.min(geometry.maxY, value.y)),
        };
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        const image = imageRef.current;
        const geometry = getGeometry();
        if (!canvas || !context || !image || !geometry) return;

        context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        context.drawImage(
            image,
            (CANVAS_SIZE - geometry.width) / 2 + offset.x,
            (CANVAS_SIZE - geometry.height) / 2 + offset.y,
            geometry.width,
            geometry.height,
        );
    }, [ready, zoom, offset]);

    const changeZoom = (nextZoom: number) => {
        const safeZoom = Math.max(1, Math.min(3, nextZoom));
        setZoom(safeZoom);
        setOffset((current) => clampOffset(current, safeZoom));
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const last = dragRef.current;
        if (!last) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const multiplier = CANVAS_SIZE / bounds.width;
        const next = clampOffset({
            x: offset.x + (event.clientX - last.x) * multiplier,
            y: offset.y + (event.clientY - last.y) * multiplier,
        });
        dragRef.current = { x: event.clientX, y: event.clientY };
        setOffset(next);
    };

    const savePhoto = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.toBlob((blob) => blob && onSave(blob), "image/jpeg", 0.9);
    };

    return (
        <div className="profile-photo-editor-backdrop" role="presentation">
            <section className="profile-photo-editor" role="dialog" aria-modal="true" aria-labelledby="photo-editor-title">
                <div className="profile-photo-editor__heading">
                    <div>
                        <span className="settings-eyebrow">Profile photo</span>
                        <h2 id="photo-editor-title">Adjust your photo</h2>
                        <p>Drag to reposition, then zoom until the framing looks right.</p>
                    </div>
                    <button type="button" className="profile-photo-editor__close" onClick={onCancel} disabled={saving} aria-label="Close photo editor">×</button>
                </div>

                <div className="profile-photo-editor__preview">
                    <canvas
                        ref={canvasRef}
                        width={CANVAS_SIZE}
                        height={CANVAS_SIZE}
                        onPointerDown={(event) => {
                            dragRef.current = { x: event.clientX, y: event.clientY };
                            event.currentTarget.setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={handlePointerMove}
                        onPointerUp={(event) => {
                            dragRef.current = null;
                            event.currentTarget.releasePointerCapture(event.pointerId);
                        }}
                        onPointerCancel={() => { dragRef.current = null; }}
                        aria-label="Profile photo crop preview. Drag the photo to reposition it."
                    />
                    <span className="profile-photo-editor__crop-ring" aria-hidden="true" />
                </div>

                <div className="profile-photo-editor__zoom">
                    <button type="button" onClick={() => changeZoom(zoom - 0.1)} disabled={saving || zoom <= 1} aria-label="Zoom out">−</button>
                    <label htmlFor="profile-photo-zoom">Zoom</label>
                    <input
                        id="profile-photo-zoom"
                        type="range"
                        min="1"
                        max="3"
                        step="0.01"
                        value={zoom}
                        onChange={(event) => changeZoom(Number(event.target.value))}
                        disabled={saving}
                    />
                    <button type="button" onClick={() => changeZoom(zoom + 0.1)} disabled={saving || zoom >= 3} aria-label="Zoom in">+</button>
                    <output>{Math.round(zoom * 100)}%</output>
                </div>

                {error && <div className="error-message profile-photo-editor__error" role="alert">{error}</div>}

                <div className="profile-photo-editor__actions">
                    <button type="button" className="cancel-btn" onClick={onCancel} disabled={saving}>Cancel</button>
                    <button type="button" className="submit-btn" onClick={savePhoto} disabled={saving || !ready}>
                        {saving ? "Saving photo…" : "Save photo"}
                    </button>
                </div>
            </section>
        </div>
    );
}
