# Video Streaming LMS

This is a Proof of Concept (POC) for a secure video streaming system built using **MERN Stack** with **Redis caching**.  
The project has two parts: **Frontend (React)** and **Backend (Node.js/Express)**.  

---

## 🚀 Tech Stack
- **Frontend**: React (localhost:3000)
- **Backend**: Node.js + Express (localhost:8000)
- **Database**: MongoDB
- **Cache**: Redis (port 6379)
- **Storage**: AWS S3 (for videos)

---

## 🔧 Installation & Setup

### 1. Clone Repository
```
git clone <your-repo-url>
cd <your-project-folder>
```

### 2. Backend Setup
```
cd backend
npm install
node server.js
```
- Runs on **http://localhost:8000**

### 3. Frontend Setup
```
cd frontend
npm install
npm start
```
- Runs on **http://localhost:3000**

### 4. Redis
Make sure Redis is running locally on **port 6379**:
```
redis-server
```

---

## 🔑 Login Credentials

You can use the following test accounts:

| Role   | Email              | Password |
|--------|--------------------|----------|
| Admin  | admin@gmail.com    | 123456   |
| Parent | parent@gmail.com   | 123456   |
| Child  | child@gmail.com    | 123456   |
| Other  | other@gmail.com    | 123456   |

---

## 📂 Project Structure
```
project-root/
│── backend/         # Express + Node.js API
│   └── server.js
│── frontnew/        # React app
│── README.md
```

---

## ⚡ Features
- User authentication & role-based access
- Multipart video upload to AWS S3
- Video streaming with **range requests**
- Redis caching for performance
- Secure access with JWT authentication

---

## 📝 Notes
- Ensure MongoDB is running locally or update `.env` with your connection string.
- Update `.env` in backend with your AWS S3 credentials and secret keys.
