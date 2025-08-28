import React from "react";
import axios from "axios";

export default function Navbar({ onLogout }) {
  const handleLogout = async () => {
    const token = localStorage.getItem("token");
    const sessionId = localStorage.getItem("sessionId");

    try {
      await axios.post(
        "http://localhost:8000/api/logout",
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-session-id": sessionId,
          },
        }
      );
    } catch (err) {
      console.error("Logout API error:", err.response?.data || err.message);
    }

    // Always clear localStorage
    localStorage.removeItem("token");
    localStorage.removeItem("sessionId");

    onLogout();
  };

  return (
    <div className="flex justify-between bg-gray-800 text-white p-3">
      <h1 className="font-bold">LMS Video App</h1>
      <button
        onClick={handleLogout}
        className="bg-red-500 px-3 py-1 rounded"
      >
        Logout
      </button>
    </div>
  );
}
