import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

const VideoPlayer = () => {
  const { id: contentId } = useParams();
  const token = localStorage.getItem("token");
  const [sessionId, setSessionId] = useState(localStorage.getItem("sessionId"));
  const [error, setError] = useState(null);
  const videoRef = useRef(null);

  const baseUrl = "http://localhost:8000/api";

  const getVideoUrl = (sid = sessionId) =>
    sid
      ? `${baseUrl}/stream/${contentId}?session=${sid}&&token=${token}`
      : `${baseUrl}/stream/${contentId}?token=${token}`;

  const [videoUrl, setVideoUrl] = useState(getVideoUrl());

  // Fetch new sessionId if expired
  const refreshSession = async () => {
    if (!contentId || !token) return;

    try {
      const response = await axios.head(getVideoUrl(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Range: "bytes=0-1000",
        },
      });

      const newSessionId = response.headers["x-session-id"];
      if (newSessionId && newSessionId !== sessionId) {
        console.log("🔄 Session refreshed:", newSessionId);

        const currentTime = videoRef.current?.currentTime || 0;
        const wasPaused = videoRef.current?.paused ?? true; // track pause/play

        setSessionId(newSessionId);
        localStorage.setItem("sessionId", newSessionId);

        const newUrl = getVideoUrl(newSessionId);
        setVideoUrl(newUrl);

        // Reload video
        if (videoRef.current) {
          videoRef.current.src = newUrl;

          videoRef.current.onloadedmetadata = async () => {
            videoRef.current.currentTime = currentTime;

            if (!wasPaused) {
              try {
                await videoRef.current.play();
              } catch (e) {
                console.warn("Autoplay blocked:", e);
              }
            }
          };
        }
      }
    } catch (err) {
      console.error("❌ Session refresh failed:", err.response?.data || err.message);
    }
  };

  // Auto refresh every 4 minutes (if expiry is 5 min)
  useEffect(() => {
    const interval = setInterval(() => {
      console.log("⏱️ Auto refreshing session...");
      refreshSession();
    }, 1000 * 10);

    return () => clearInterval(interval);
  }, [sessionId]);

  if (!token) return <div style={{ color: "red" }}>No token found. Please login.</div>;
  if (error) return <div style={{ color: "red" }}>{error}</div>;

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <video
        ref={videoRef}
        controls
        style={{ width: "100%", maxHeight: "500px" }}
        src={videoUrl}
        type="video/mp4"
        onPlay={async () => {
          console.log("▶️ Play pressed, checking session...");
          await refreshSession();
        }}
        onError={(e) => {
          console.error("Video playback error:", e);
          if (e?.target?.error?.code === e.target.error.MEDIA_ERR_SRC_NOT_SUPPORTED) {
            refreshSession();
          } else {
            setError("Error playing video.");
          }
        }}
      />
    </div>
  );
};

export default VideoPlayer;
