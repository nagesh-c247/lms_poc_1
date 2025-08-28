import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

const VideoPlayer = () => {
  const { id: contentId } = useParams(); // Dynamic contentId from route
  const token = localStorage.getItem("token");
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState(null);
  const baseUrl = "http://localhost:8000/api"; // Adjusted base URL to include /api

  // Construct video URL based on sessionId or token
  const videoUrl = sessionId
    ? `${baseUrl}/stream/${contentId}?session=${sessionId}`
    : `${baseUrl}/stream/${contentId}?token=${token}`;

  useEffect(() => {
    const testEndpoint = async () => {
      if (!contentId || !token) return;

      try {
        console.log("Testing video endpoint with URL:", videoUrl);
        const response = await axios.head(videoUrl, {
          headers: {
            // Authorization header might be optional since token is in URL
            Authorization: `Bearer ${token}`,
            Range: "bytes=0-1000",
          },
        });

        console.log("Video endpoint test successful:", response.headers);
        const newSessionId = response.headers["x-session-id"];
        console.log("X-Session-ID from response headers:", newSessionId);
        if (newSessionId) {
          console.log("Received session ID:", newSessionId);
          setSessionId(newSessionId);
          localStorage.setItem("sessionId", newSessionId); // 🔹 store in localStorage
        }
      } catch (err) {
        console.error(
          "Error testing video endpoint:",
          err.response ? err.response.data : err.message
        );
        setError(
          "Failed to access video. Check your token, session ID, or server logs."
        );
      }
    };

    testEndpoint();
  }, [contentId, token, videoUrl]);

  if (!token) return <div style={{ color: "red" }}>No token found. Please login.</div>;
  if (error) return <div style={{ color: "red" }}>{error}</div>;

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <video
        controls
        autoPlay={false}
        style={{ width: "100%", maxHeight: "500px" }}
        src={videoUrl}
        type="video/mp4"
        onError={(e) => {
          console.error("Video playback error:", e);
          setError("Error playing video. The file may be corrupted or unsupported.");
        }}
        onCanPlay={() => console.log("Video is ready to play")}
        onWaiting={() => console.log("Video is buffering")}
        onStalled={() => console.log("Video stalled, waiting for data")}
        onProgress={(e) => {
          const buffered = e.target.buffered;
          if (buffered.length > 0) {
            console.log(
              "Buffered ranges:",
              Array.from({ length: buffered.length }, (_, i) => ({
                start: buffered.start(i),
                end: buffered.end(i),
              }))
            );
          }
        }}
      >
        Your browser does not support the video tag.
      </video>
    </div>
  );
};

export default VideoPlayer;
