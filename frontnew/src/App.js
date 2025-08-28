import React, { useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import SignIn from "./components/SignIn";
import UploadVideo from "./components/UploadVideo";
import VideoList from "./components/VideoList";
import VideoPlayer from "./components/VideoPlayer";
import Navbar from "./components/Navbar";

function PrivateRoute({ children }) {
  return localStorage.getItem("token") ? children : <Navigate to="/signin" />;
}

function AdminRoute({ children }) {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  return user.role === "admin" ? children : <Navigate to="/" />;
}

function Dashboard({ user, setVideos }) {
  if (!user) return null; // prevent blank screen
  return (
    <div className="p-4">
      {user.role === "admin" && <UploadVideo onUploaded={setVideos} />}
      <VideoList refreshVideos={setVideos} />
    </div>
  );
}

function App() {
  const [user, setUser] = useState(() => {
    const u = localStorage.getItem("user");
    return u ? JSON.parse(u) : null;
  });

  const [videos, setVideos] = useState([]);

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
              <Dashboard user={user} setVideos={setVideos} />
            </PrivateRoute>
          }
        />

        <Route
          path="/upload"
          element={
            <PrivateRoute>
              <AdminRoute>
                <UploadVideo onUploaded={setVideos} />
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

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;
