"use client";

import { useEffect, useRef } from "react";
import {
  isPersonalVideoImagePosterUrl,
  personalVideoPreviewSeekSrc,
} from "@/personal/video-generation/poster-url";

type PersonalVideoHistoryThumbProps = {
  posterUrl: string | null;
  videoUrl: string | null;
};

export function PersonalVideoHistoryThumb({
  posterUrl,
  videoUrl,
}: PersonalVideoHistoryThumbProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imagePoster = isPersonalVideoImagePosterUrl(posterUrl)
    ? posterUrl
    : null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || imagePoster || !videoUrl) return;

    const seekToCover = () => {
      try {
        if (video.currentTime < 0.05) {
          video.currentTime = 0.1;
        }
      } catch {
        /* ignore seek errors before metadata is ready */
      }
    };

    video.addEventListener("loadeddata", seekToCover);
    return () => video.removeEventListener("loadeddata", seekToCover);
  }, [imagePoster, videoUrl]);

  if (imagePoster) {
    return (
      <img
        src={imagePoster}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    );
  }

  if (videoUrl) {
    return (
      <video
        ref={videoRef}
        src={personalVideoPreviewSeekSrc(videoUrl)}
        muted
        playsInline
        preload="metadata"
        draggable={false}
      />
    );
  }

  return <div className="personal-video-card__thumb-placeholder" />;
}
