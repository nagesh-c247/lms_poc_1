const express = require('express');
const cors = require('cors');
const app = express();
const User = require('./userModel');
const jwt = require('jsonwebtoken');
const s3 = require('./awsConf'); // AWS S3 configuration
const crypto = require('crypto');
const Content = require('./contentModel');
const bucketName = 'lms-poc-c247';
const redis = require('redis');
const mime = require('mime-types');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs').promises;
const { createReadStream, createWriteStream } = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
app.use(cors({ origin: 'http://localhost:3000' ,exposedHeaders: ["x-session-id", "x-session-expired"]}));
app.use(express.json());


const redisClient = redis.createClient({
  url: 'redis://localhost:6379', // Adjust if using a different Redis host/port
});
redisClient.on('error', (err) => console.error('Redis error:', err));
redisClient.connect();

// JWT configuration
const JWT_SECRET = 'your_jwt_secret_key';
const JWT_EXPIRES_IN = '1h';

function signJwtForUser(user) {
  const payload = {
    sub: String(user._id),
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN });
}

// -------------------------------
// 🔹 Session Handling
// -------------------------------
const createSession = async (decoded, contentId) => {
  role = decoded.role;
  exp = decoded.exp;

  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(10, exp - now);

  const newSessionId = uuidv4();
  await redisClient.setEx(
    `session:${newSessionId}`,
    ttl,
    JSON.stringify({ role, contentId, exp })
  );

  res.setHeader('x-session-id', newSessionId);
  return { role, exp };
};

// Middleware to authenticate JWT
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  console.log('Received token:', token);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    console.log('Authenticated user:', req.user);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Sign-in API
app.post('/api/signin', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // Replace with proper password comparison (e.g., using bcrypt)
    // if (!(await bcrypt.compare(password, user.passwordHash))) {
    //   return res.status(401).json({ error: 'Invalid credentials' });
    // }

    const token = signJwtForUser(user);
    res.json({ token,
      user
     });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Sign-up API
app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body;
  try {
    // Replace with proper password hashing (e.g., using bcrypt)
    // const passwordHash = await bcrypt.hash(password, 10);
    const passwordHash = password; // Temporary, replace with bcrypt
    const newUser = new User({ email: email.toLowerCase().trim(), passwordHash });
    await newUser.save();
    res.json({ message: 'User created successfully' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout API
app.post('/api/logout', authenticateJWT, async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
      await redisClient.del(`session:${sessionId}`);
      console.log(`Session ${sessionId} invalidated`);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


//fetch all content
app.get('/api/content', async (req, res) => {
  try {
    const contents = await Content.find({});
    res.status(200).json({
      contents
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }

})
//without encryption apis


app.post("/api/upload", authenticateJWT, async (req, res, next) => {
  try {
    if (req.user.role !== "admin") return res.status(403).send("Forbidden");

    const filename = req.headers['x-file-name'];
    console.log('Upload request by user:', req.user);

    // Create temporary file paths
    const tempInputFile = path.join(os.tmpdir(), `input-${Date.now()}.mp4`);
    const tempOutputFile = path.join(os.tmpdir(), `output-${Date.now()}.mp4`);

    // Step 1: Save incoming chunks to a temporary file
    const writeStream = require('fs').createWriteStream(tempInputFile);
    for await (const chunk of req) {
      writeStream.write(chunk);
    }
    writeStream.end();
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Step 2: Process the file with FFmpeg (e.g., transcode to H.264)
    await new Promise((resolve, reject) => {
      ffmpeg(tempInputFile)
        .videoCodec('libx264') // Use H.264 codec
        .audioCodec('aac') // Use AAC audio codec
        .format('mp4') // Output format
        .outputOptions([
          '-movflags faststart', // Optimize for web streaming
          '-preset fast', // Encoding speed vs. compression
          '-crf 23', // Constant Rate Factor (quality, lower is better)
        ])
        .save(tempOutputFile)
        .on('end', () => {
          console.log('FFmpeg processing complete');
          resolve();
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(err);
        });
    });

    // Step 3: Initiate multipart upload to S3
    const createRes = await s3.createMultipartUpload({
      Bucket: bucketName,
      Key: `videos/${Date.now()}.mp4`,
    }).promise();

    const uploadId = createRes.UploadId;
    const parts = [];
    let partNumber = 1;

    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
    const fileBuffer = await fs.readFile(tempOutputFile);
    let buffer = Buffer.from(fileBuffer);
    let start = 0;

    // Step 4: Upload processed file in chunks
    while (start < buffer.length) {
      const end = Math.min(start + CHUNK_SIZE, buffer.length);
      const piece = buffer.subarray(start, end);

      const uploadRes = await s3.uploadPart({
        Bucket: bucketName,
        Key: createRes.Key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: piece,
      }).promise();

      parts.push({ ETag: uploadRes.ETag, PartNumber: partNumber });
      partNumber++;
      start += CHUNK_SIZE;
    }

    // Step 5: Complete multipart upload
    await s3.completeMultipartUpload({
      Bucket: bucketName,
      Key: createRes.Key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }).promise();

    // Step 6: Save metadata
    const content = new Content({
      title: filename,
      s3Key: createRes.Key,
      allowedRoles: ["parent", "child", "admin"],
    });
    await content.save();

    // Step 7: Clean up temporary files
    await Promise.all([
      fs.unlink(tempInputFile).catch((err) => console.error('Failed to delete input file:', err)),
      fs.unlink(tempOutputFile).catch((err) => console.error('Failed to delete output file:', err)),
    ]);

    res.json({ contentId: content._id, key: createRes.Key });
  } catch (err) {
    console.error("Upload error:", err);

    // Clean up temporary files in case of error
    const tempInputFile = path.join(os.tmpdir(), `input-${Date.now()}.mp4`);
    const tempOutputFile = path.join(os.tmpdir(), `output-${Date.now()}.mp4`);
    await Promise.all([
      fs.unlink(tempInputFile).catch(() => {}),
      fs.unlink(tempOutputFile).catch(() => {}),
    ]);

    res.status(500).send("Upload failed");
  }

});



app.get('/api/stream/:id', async (req, res) => {
  const startTime = Date.now();

  try {
    const contentId = req.params.id;
    const sessionId = req.query.session;
    const authHeader = req.headers.authorization;
    const token =
      req.query.token ||
      (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null);

    let role, content, exp;

    // -------------------------------
    // 🔹 Load content metadata (Redis + MongoDB fallback)
    // -------------------------------
    const contentCacheKey = `content:${contentId}`;
    let contentData = await redisClient.get(contentCacheKey);

    if (contentData) {
      content = JSON.parse(contentData);
    } else {
      content = await Content.findById(contentId).lean();
      if (!content) return res.status(404).send('Not found');
      await redisClient.setEx(contentCacheKey, 3600, JSON.stringify(content));
    }

    // -------------------------------
    // 🔹 Session Handling
    // -------------------------------
    const createSession = async (decoded, contentId) => {
      role = decoded.role;
      exp = decoded.exp;

      const now = Math.floor(Date.now() / 1000);
      const ttl = Math.min(10, exp - now);

      const newSessionId = uuidv4();
      await redisClient.setEx(
        `session:${newSessionId}`,
        ttl,
        JSON.stringify({ role, contentId, exp })
      );

      res.setHeader('x-session-id', newSessionId);
      return { role, exp };
    };

    if (sessionId) {
      const sessionKey = `session:${sessionId}`;
      const sessionData = await redisClient.get(sessionKey);

      if (sessionData) {
        const session = JSON.parse(sessionData);
        const nowSeconds = Math.floor(Date.now() / 1000);

        if (session.contentId !== contentId)
          return res.status(403).send('Forbidden');

        if (nowSeconds >= session.exp) {
          // 🔹 Session expired
          if (!token) {
            res.setHeader('x-session-expired', 'true');
            return res.status(440).send('Session expired');
          }

          let decoded;
          try {
            decoded = jwt.verify(token, JWT_SECRET);
          } catch (err) {
            await redisClient.del(sessionKey);
            return res.status(401).send('Invalid or expired token');
          }

          await createSession(decoded, contentId);
        } else {
          // 🔹 Session active → refresh TTL
          role = session.role;
          exp = session.exp;
          const remainingSeconds = exp - nowSeconds;
          await redisClient.expire(sessionKey, Math.min(10, remainingSeconds));
        }
      } else {
        // 🔹 Session not found → check token
        if (!token) {
          res.setHeader('x-session-expired', 'true');
          return res.status(440).send('Session expired');
        }

        let decoded;
        try {
          decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
          return res.status(401).send('Invalid or expired token');
        }

        await createSession(decoded, contentId);
      }
    } else {
      // 🔹 No session → create using token
      if (!token) return res.status(401).send('Unauthorized');

      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (err) {
        return res.status(401).send('Invalid or expired token');
      }

      await createSession(decoded, contentId);
    }

    // -------------------------------
    // 🔹 Role validation
    // -------------------------------
    if (!content.allowedRoles.includes(role))
      return res.status(403).send('Forbidden');

    // -------------------------------
    // 🔹 Range parsing
    // -------------------------------
    const range = req.headers.range;
    if (!range) return res.status(416).send('Range header required');

    const match = range.match(/bytes=(\d+)-(\d*)/);
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start + 2 * 10 ** 6;

    const headRes = await s3
      .headObject({ Bucket: bucketName, Key: content.s3Key })
      .promise();

    const fileSize = headRes.ContentLength;
    const finalEnd = Math.min(end, fileSize - 1);
    const contentLength = finalEnd - start + 1;

    // -------------------------------
    // 🔹 Stream from S3
    // -------------------------------
    const s3Stream = s3
      .getObject({
        Bucket: bucketName,
        Key: content.s3Key,
        Range: `bytes=${start}-${finalEnd}`,
      })
      .createReadStream();

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${finalEnd}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': contentLength,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-cache',
    });

    s3Stream.on('error', () => {
      if (!res.headersSent) res.status(500).send('Stream failed');
    });

    s3Stream.pipe(res);
  } catch (err) {
    console.error(`Stream error: ${err.message}`);
    if (!res.headersSent) res.status(500).send('Stream failed');
  }
});



module.exports = app;