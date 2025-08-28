import React, { useEffect, useState } from "react";
import api from "../api";
import { useNavigate } from "react-router-dom";

export default function VideoList({ refreshVideos }) {
  const [videos, setVideos] = useState([]);
  const navigate = useNavigate();

  const fetchVideos = async () => {
    const res = await api.get("/content");
    setVideos(res.data.contents);
  };

  useEffect(() => {
    fetchVideos();
  }, [refreshVideos]); // re-fetch when parent calls

  return (
    <div className="p-4">
      <h2 className="font-bold mb-2">Available Videos</h2>
      <ul>
        {videos.map((v) => (
          <li
            key={v._id}
            className="cursor-pointer text-blue-600 underline"
            onClick={() => navigate(`/player/${v._id}`)}
          >
            {v.title || "Untitled Video"}
          </li>
        ))}
      </ul>
    </div>
  );
}
