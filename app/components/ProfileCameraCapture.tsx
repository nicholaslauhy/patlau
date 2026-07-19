"use client";

import { useEffect, useRef, useState } from "react";

interface ProfileCameraCaptureProps {
    onCancel: () => void;
    onCapture: (file: File) => void;
    onChoosePhoto: () => void;
}

export default function ProfileCameraCapture({ onCancel, onCapture, onChoosePhoto }: ProfileCameraCaptureProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [error, setError] = useState("");
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let active = true;

        const startCamera = async () => {
            if (!navigator.mediaDevices?.getUserMedia) {
                setError("Camera access is not available in this browser.");
                return;
            }

            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "user" },
                    audio: false,
                });
                if (!active) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }
                streamRef.current = stream;
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play();
                }
            } catch {
                if (active) setError("Camera permission was not granted. You can choose a photo instead.");
            }
        };

        void startCamera();
        return () => {
            active = false;
            streamRef.current?.getTracks().forEach((track) => track.stop());
        };
    }, []);

    const capture = () => {
        const video = videoRef.current;
        if (!video || !video.videoWidth || !video.videoHeight) return;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) return;

        context.translate(canvas.width, 0);
        context.scale(-1, 1);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
            if (!blob) return;
            onCapture(new File([blob], "camera-photo.jpg", { type: "image/jpeg" }));
        }, "image/jpeg", 0.92);
    };

    return (
        <div className="profile-photo-editor-backdrop" role="presentation">
            <section className="profile-photo-editor profile-camera" role="dialog" aria-modal="true" aria-labelledby="camera-title">
                <div className="profile-photo-editor__heading">
                    <div>
                        <span className="settings-eyebrow">Profile photo</span>
                        <h2 id="camera-title">Take a photo</h2>
                        <p>Position yourself in the frame. You can crop and zoom after capturing.</p>
                    </div>
                    <button type="button" className="profile-photo-editor__close" onClick={onCancel} aria-label="Close camera">×</button>
                </div>

                <div className="profile-camera__preview">
                    <video ref={videoRef} muted playsInline onCanPlay={() => setReady(true)} />
                    {!ready && !error && <div className="profile-camera__loading">Starting camera…</div>}
                    {error && <div className="profile-camera__unavailable">{error}</div>}
                </div>

                <div className="profile-photo-editor__actions">
                    <button type="button" className="cancel-btn" onClick={onChoosePhoto}>Choose photo</button>
                    <button type="button" className="submit-btn" onClick={capture} disabled={!ready || Boolean(error)}>Capture photo</button>
                </div>
            </section>
        </div>
    );
}
