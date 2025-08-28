import React from "react";

export default function Navbar({ onLogout }) {
  return (
    <div className="flex justify-between bg-gray-800 text-white p-3">
      <h1 className="font-bold">LMS Video App</h1>
      <button
        onClick={() => {
          localStorage.removeItem("token");
          onLogout();
        }}
        className="bg-red-500 px-3 py-1 rounded"
      >
        Logout
      </button>
    </div>
  );
}
