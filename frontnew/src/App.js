import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import SignIn from "./components/SignIn";
import UploadVideo from "./components/UploadVideo";
import VideoList from "./components/VideoList";
import VideoPlayer from "./components/VideoPlayer";
import Navbar from "./components/Navbar";
import api from "./api";
import VideoListABR from "./components/VideoListABR";
import VideoPlayerABR from "./components/VideoPlayerABR";

function PrivateRoute({ children }) {
  return localStorage.getItem("token") ? children : <Navigate to="/signin" />;
}

function AdminRoute({ children }) {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  return user.role === "admin" ? children : <Navigate to="/" />;
}

function Dashboard({ user, videos, fetchVideos, setVideos }) {
  if (!user) return null; // prevent blank screen

  return (
    <div className="p-4">
      {user.role === "admin" && <UploadVideo onUploaded={fetchVideos} />}
      <VideoList videos={videos} />
      <VideoListABR />
    </div>
  );
}

function App() {
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem("user");
    return u ? JSON.parse(u) : null;
  });

  const [videos, setVideos] = useState([]);

  const fetchVideos = async () => {
    try {
      const res = await api.get("/content", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      setVideos(res.data.contents);
    } catch (err) {
      console.error("Error fetching videos:", err.response?.data || err.message);
    }
  };

  useEffect(() => {
    if (user) fetchVideos();
  }, [user]);

  const handleLogout = () => {
    localStorage.clear();
    setUser(null);
  };

  return (
    <Router>
      {user && <Navbar onLogout={handleLogout} />}
      <Routes>
        <Route
          path="/signin"
          element={user ? <Navigate to="/" /> : <SignIn onLogin={setUser} />}
        />

        <Route
          path="/"
          element={
            <PrivateRoute>
              <Dashboard
                user={user}
                videos={videos}
                fetchVideos={fetchVideos}
                setVideos={setVideos}
              />
            </PrivateRoute>
          }
        />

        <Route
          path="/upload"
          element={
            <PrivateRoute>
              <AdminRoute>
                <UploadVideo onUploaded={fetchVideos} />
              </AdminRoute>
            </PrivateRoute>
          }
        />

        <Route
          path="/player/:id"
          element={
            <PrivateRoute>
              <VideoPlayer />
            </PrivateRoute>
          }
        />
        <Route
        path="/playerabr/:id"
        element={
          <PrivateRoute>
            <VideoPlayerABR />
          </PrivateRoute>
        }
        />

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;
