# Video Streaming LMS

This is a Proof of Concept (POC) for a secure video streaming system built using the **MERN Stack**, with **Kafka** for event streaming, **Redis** for caching/pub-sub, and **FFmpeg** for video transcoding.

---

## Tech Stack
- Frontend: React (http://localhost:3000)
- Backend: Node.js + Express (http://localhost:8000)
- Database: MongoDB
- Cache: Redis (port 6379)
- Message Broker: Kafka (port 9092, Zookeeper on 2181)
- Transcoding: FFmpeg (via Docker container)
- Storage: AWS S3 (for videos)

---

## Installation & Setup

### Clone Repository
```bash
git clone <your-repo-url>
cd <your-project-folder>
```

### Start Dependencies (Kafka, Zookeeper, Redis, FFmpeg)
```bash
docker-compose up -d
```

### Backend Setup
```bash
cd backend
npm install
node server.js
```
Runs on: http://localhost:8000

### Frontend Setup
```bash
cd frontend
npm install
npm start
```
Runs on: http://localhost:3000

### Using FFmpeg in Container
```bash
docker exec -it ffmpeg ffmpeg -i /data/input.mp4 -c:v libx264 /data/output.mp4
```

Mount videos into the `./videos` folder (mapped to `/data` in the container).

---

## Login Credentials
| Role   | Email              | Password |
|--------|--------------------|----------|
| Admin  | admin@gmail.com    | 123456   |
| Parent | parent@gmail.com   | 123456   |
| Child  | child@gmail.com    | 123456   |
| Other  | other@gmail.com    | 123456   |

---

## Project Structure
```
project-root/
│── backend/             # Express + Node.js API
│   └── server.js
│── frontend/            # React app
│── docker-compose.yml   # Zookeeper + Kafka + Redis + FFmpeg
│── videos/              # Local folder for video files (mounted into FFmpeg)
│── README.md
```

---

## Features
- User authentication & role-based access
- Multipart video upload to AWS S3
- Video streaming with range requests
- Redis caching for performance & session management
- Kafka for event-driven workflows (video encoding, notifications, logs)
- FFmpeg for transcoding and adaptive bitrate streaming
- Secure access with JWT authentication

---

## Notes
- Ensure MongoDB is running locally or update `.env` with your connection string.
- Update `.env` in backend with AWS S3 credentials, Redis host/port, Kafka broker URL.
- Run all dependencies via `docker-compose up -d`.
- Place video files in `./videos` to access them inside the FFmpeg container.

