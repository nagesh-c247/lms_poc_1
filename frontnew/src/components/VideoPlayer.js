import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

const VideoPlayer = () => {
  const { id: contentId } = useParams();
  const token = localStorage.getItem("token");
  const [sessionId, setSessionId] = useState(localStorage.getItem("sessionId"));
  const [videoUrl, setVideoUrl] = useState("");
  const [error, setError] = useState(null);
  const videoRef = useRef(null);

  const baseUrl = "http://localhost:8000/api";

  const getVideoUrl = (sid) =>
    `${baseUrl}/stream/${contentId}?session=${sid}&token=${token}`;

  // 🔹 Step 1: Fetch initial session before playing video
  const initSession = async () => {
    try {
      const res = await axios.head(`${baseUrl}/stream/${contentId}?token=${token}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Range: "bytes=0-1000",
          "is-first": true, // backend should handle this
        },
      });

      const newSessionId = res.headers["x-session-id"];
      if (newSessionId) {
        setSessionId(newSessionId);
        localStorage.setItem("sessionId", newSessionId);

        const url = getVideoUrl(newSessionId);
        setVideoUrl(url);
        console.log("✅ Initial session set:", newSessionId);
      }
    } catch (err) {
      console.error("❌ Failed to init session:", err);
      setError("Could not initialize session");
    }
  };

  // 🔹 Step 2: Intercept session rotation from backend while streaming
  const handleProgress = async () => {
    try {
      if (!videoRef.current) return;
      const res = await axios.head(getVideoUrl(sessionId), {
        headers: {
          Authorization: `Bearer ${token}`,
          Range: `bytes=0-1000`,
        },
      });

 

      const newSessionId = res.headers["x-session-id"];
     
      if (newSessionId && newSessionId !== sessionId) {
        console.log("🔄 Session rotated:", newSessionId);
        setSessionId(newSessionId);
        localStorage.setItem("sessionId", newSessionId);
      }
    } catch (err) {
      console.error("❌ Session check failed:", err.message);
    }
  };

  useEffect(() => {
    initSession();
  }, []);

  if (!token) return <div style={{ color: "red" }}>No token found. Please login.</div>;
  if (error) return <div style={{ color: "red" }}>{error}</div>;

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      {videoUrl ? (
        <video
          ref={videoRef}
          controls
          style={{ width: "100%", maxHeight: "500px" }}
          src={videoUrl}
          type="video/mp4"
          onTimeUpdate={handleProgress} // 🔹 check headers while playing
        />
      ) : (
        <p>Loading video...</p>
      )}
    </div>
  );
};

export default VideoPlayer;
