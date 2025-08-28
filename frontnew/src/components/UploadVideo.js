import React, { useState } from "react";
import api from "../api";

export default function UploadVideo({ onUploaded }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("");

  const handleUpload = async () => {
    if (!file) return;

    try {
      setStatus("Uploading...");

      const res = await api.post("/upload", file, {
        headers: {
          "Content-Type": file.type || "application/octet-stream", // dynamic MIME
          "x-file-name": file.name, // backend requires file name
          Authorization: `Bearer ${localStorage.getItem("token")}`, // JWT
        },
      });

      setStatus("Upload complete ✅");

      // 👇 notify parent to refresh VideoList
      if (onUploaded) {
        onUploaded(res.data); 
      }

      // reset file input
      setFile(null);
    } catch (err) {
      console.error("Upload error:", err.response?.data || err.message);
      setStatus("Upload failed ❌");
    }
  };

  return (
    <div className="p-4 bg-gray-100 rounded-lg mb-4">
      <h2 className="font-bold">Upload Video (Admin)</h2>

      <input
        type="file"
        accept="video/*"
        onChange={(e) => setFile(e.target.files[0])}
      />

      <button
        onClick={handleUpload}
        disabled={!file}
        className="bg-blue-500 text-white px-3 py-1 rounded ml-2 disabled:opacity-50"
      >
        {file ? "Upload" : "Choose File First"}
      </button>

      <p>{status}</p>
    </div>
  );
}
