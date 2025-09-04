import React, { useEffect, useRef, useState, useMemo } from "react";
import Hls from "hls.js";
import { useParams } from "react-router-dom";

const VideoPlayerABR = () => {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const { id: contentId } = useParams();

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [levels, setLevels] = useState([]);
  const [audioTracks, setAudioTracks] = useState([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [currentAudioTrack, setCurrentAudioTrack] = useState(-1);

  // API URL (master manifest from your backend)
  const apiUrl = useMemo(
    () =>
      contentId
        ? `http://localhost:8000/api/streamabr/${contentId}?type=hls`
        : null,
    [contentId]
  );

  const jwtToken = useMemo(
    () => localStorage.getItem("token") || "your-jwt-token-here",
    []
  );

  useEffect(() => {
    if (!contentId || !apiUrl) {
      setError("Content ID is missing from URL");
      setLoading(false);
      return;
    }

    if (!Hls.isSupported()) {
      setError("HLS.js is not supported in this browser");
      setLoading(false);
      return;
    }

    const hls = new Hls({
      debug: true, // enable for dev; disable in prod
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      liveSyncDurationCount: 3,
      enableWorker: true,
      lowLatencyMode: false,
      xhrSetup: (xhr) => {
        if (jwtToken) {
          xhr.setRequestHeader("Authorization", `Bearer ${jwtToken}`);
        }
      },
    });

    hlsRef.current = hls;

    // === Event hooks ===
    hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
      console.log("HLS.js: Manifest parsed", data);
      setLevels(
        data.levels.map((l, idx) => ({
          index: idx,
          bitrate: l.bitrate,
          resolution: `${l.width}x${l.height}`,
          codecs: l.codecs,
        }))
      );
      setLoading(false);
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
      console.log("HLS.js: Level switched", data);
      setCurrentLevel(data.level);
    });

    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
      console.log("HLS.js: Audio tracks updated", data);
      setAudioTracks(
        data.audioTracks.map((t, idx) => ({
          index: idx,
          name: t.name,
          groupId: t.groupId,
          lang: t.lang,
        }))
      );
    });

    hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
      console.log("HLS.js: Audio track switched", data);
      setCurrentAudioTrack(data.id);
    });

    hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
      console.log("HLS.js: Fragment loaded", {
        url: data.frag.url,
        type: data.frag.type,
        duration: data.frag.duration,
      });
      if (videoRef.current && !isPlaying) {
        videoRef.current
          .play()
          .then(() => {
            setIsPlaying(true);
            console.log("Playback started after first fragment");
          })
          .catch((err) => {
            setError(`Playback error: ${err.message}`);
            console.error("Play error:", err);
          });
      }
    });

    hls.on(Hls.Events.ERROR, (_, data) => {
      console.error("HLS.js error:", data);
      if (data.fatal) {
        setError(`HLS fatal error: ${data.type} - ${data.details}`);
        hls.destroy();
      }
    });

    // Attach media + load source
    hls.attachMedia(videoRef.current);
    hls.loadSource(apiUrl);

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [apiUrl, jwtToken, contentId, isPlaying]);

  const handlePlay = () => {
    if (videoRef.current) {
      videoRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          setError(`Playback error: ${err.message}`);
          console.error("Play error:", err);
        });
    }
  };

  const handleQualityChange = (e) => {
    const levelIndex = parseInt(e.target.value, 10);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex;
    }
  };

  const handleAudioChange = (e) => {
    const trackIndex = parseInt(e.target.value, 10);
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackIndex;
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <h1 className="text-2xl font-bold mb-4">HLS ABR Video Player</h1>

      {loading && <p className="text-lg text-blue-600">Loading video…</p>}
      {error && <p className="text-lg text-red-600">{error}</p>}

      <div className="flex flex-col items-center justify-center bg-gray-100 p-4">
  <h1 className="text-2xl font-bold mb-4">HLS ABR Video Player</h1>

  <div style={{ 
  maxWidth: "800px",      // cap max width
  width: "100%",          // responsive
  aspectRatio: "16 / 9",  // keep 16:9 shape
  position: "relative", 
  margin: "0 auto"        // center horizontally
}}>
  <video
    ref={videoRef}
    controls
    muted
    playsInline
    style={{
      width: "100%",
      height: "100%",
      borderRadius: "12px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      objectFit: "contain",
      display: error || loading ? "none" : "block"
    }}
  />
  {!isPlaying && !loading && !error && (
    <button
      onClick={handlePlay}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
        color: "white",
        fontSize: "2rem",
        border: "none",
        cursor: "pointer",
      }}
    >
      ▶ Play
    </button>
  )}
</div>

</div>


      {/* Quality selector */}
      {levels.length > 0 && (
        <div className="mt-4">
          <label className="mr-2 font-semibold">Quality:</label>
          <select
            value={currentLevel}
            onChange={handleQualityChange}
            className="border rounded p-1"
          >
            <option value={-1}>Auto</option>
            {levels.map((l) => (
              <option key={l.index} value={l.index}>
                {l.resolution} ({Math.round(l.bitrate / 1000)} kbps)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Audio track selector */}
      {audioTracks.length > 0 && (
        <div className="mt-4">
          <label className="mr-2 font-semibold">Audio:</label>
          <select
            value={currentAudioTrack}
            onChange={handleAudioChange}
            className="border rounded p-1"
          >
            {audioTracks.map((t) => (
              <option key={t.index} value={t.index}>
                {t.name || `Track ${t.index}`}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

export default VideoPlayerABR;
