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
const path = require('path');
const os = require('os');

app.use(cors({ origin: 'http://localhost:3000' ,exposedHeaders: ["x-session-id"]}));
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
// app.post("/api/upload",authenticateJWT, async (req, res,next) => {
//   try {
//     if (req.user.role !== "admin") return res.status(403).send("Forbidden");
//     const filename = req.headers['x-file-name'];
//     console.log('Upload request by user:');
//     // Step 1: Initiate multipart upload
//     const createRes = await s3.createMultipartUpload({
//       Bucket: bucketName,
//       Key: `videos/${Date.now()}.mp4`,
//     }).promise();

//     const uploadId = createRes.UploadId;
//     const parts = [];
//     let partNumber = 1;

//     const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
//     let buffer = Buffer.alloc(0);

//     for await (const chunk of req) {
//       buffer = Buffer.concat([buffer, chunk]);

//       while (buffer.length >= CHUNK_SIZE) {
//         const piece = buffer.subarray(0, CHUNK_SIZE);
//         buffer = buffer.subarray(CHUNK_SIZE);

//         const uploadRes = await s3.uploadPart({
//           Bucket: bucketName,
//           Key: createRes.Key,
//           UploadId: uploadId,
//           PartNumber: partNumber,
//           Body: piece,
//         }).promise();

//         parts.push({ ETag: uploadRes.ETag, PartNumber: partNumber });
//         partNumber++;
//       }
//     }

//     // Handle leftover
//     if (buffer.length > 0) {
//       const uploadRes = await s3.uploadPart({
//         Bucket: bucketName,
//         Key: createRes.Key,
//         UploadId: uploadId,
//         PartNumber: partNumber,
//         Body: buffer,
//       }).promise();

//       parts.push({ ETag: uploadRes.ETag, PartNumber: partNumber });
//     }

//     // Step 2: Complete upload
//     await s3.completeMultipartUpload({
//       Bucket: bucketName,
//       Key: createRes.Key,
//       UploadId: uploadId,
//       MultipartUpload: { Parts: parts },
//     }).promise();

//     // Save metadata
//     const content = new Content({
//       title: filename,
//       s3Key: createRes.Key,
     
//       allowedRoles: ["parent", "child","admin"],
//     });
//     await content.save();

//     res.json({ contentId: content._id, key: createRes.Key });
//   } catch (err) {
//     console.error("Upload error:", err);
//     res.status(500).send("Upload failed");
//   }
// });

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
    console.log(contentId)
    const sessionId = req.query.session;
    let role, content;

    // Check Redis for content metadata
    const contentCacheKey = `content:${contentId}`;
    let contentData = await redisClient.get(contentCacheKey);
    if (contentData) {
      content = JSON.parse(contentData);
      console.log(`Content cache hit for ID: ${contentId}`);
    } else {
      content = await Content.findById(contentId); // Use lean() for faster queries
      if (!content) {
        console.error('Content not found in MongoDB');
        return res.status(404).send('Not found');
      }
      await redisClient.setEx(contentCacheKey, 3600, JSON.stringify(content)); // Cache for 1 hour
      console.log(`Cached content for ID: ${contentId}`);
    }

    // Check session or token
    if (sessionId) {
      console.log('Session ID provided:', sessionId);
      const sessionKey = `session:${sessionId}`;
      const sessionData = await redisClient.get(sessionKey);
      if (sessionData) {
        const session = JSON.parse(sessionData);
        if (session.contentId !== contentId) {
          console.error(`Session content mismatch: ${sessionId}`);
          return res.status(403).send('Forbidden');
        }
        role = session.role;
        console.log(`Session cache hit: ${sessionId}, role: ${role}`);
      } else {
        console.error(`Session not found: ${sessionId}`);
        return res.status(401).send('Invalid or expired session');
      }
    } else {
      const authHeader = req.headers.authorization;
      console.log('Authorization header:', authHeader);
      const token = req.query.token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null);
      console.log('Stream token:', token);
      if (!token) {
        console.error('Missing token or session ID');
        return res.status(401).send('Unauthorized');
      }
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (err) {
        console.error('JWT verification failed:', err.message);
        return res.status(401).send('Invalid token');
      }
      role = decoded.role;

      // Create new session
      const newSessionId = require('crypto').randomUUID();
      const sessionKey = `session:${newSessionId}`;
      await redisClient.setEx(sessionKey, 300, JSON.stringify({
        role,
        contentId,
      })); // 5-minute expiration
      console.log(`Session created: ${newSessionId}, role: ${role}`);
      res.setHeader('x-session-id', newSessionId); // Send session ID
    }

    // Check role
    if (!content.allowedRoles.includes(role)) {
      console.error(`Forbidden: User role ${role} not allowed`);
      return res.status(403).send('Forbidden');
    }

    // Handle range request
    const range = req.headers.range;
    if (!range) {
      console.error('Range header missing');
      return res.status(416).send('Range header required');
    }

    // Parse range
    const match = range.match(/bytes=(\d+)-(\d*)/);
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start + 2*10 ** 6; // 1MB default chunk

    // Get object metadata
    const headRes = await s3.headObject({
      Bucket: bucketName,
      Key: content.s3Key,
    }).promise();
    const fileSize = headRes.ContentLength;
    const finalEnd = Math.min(end, fileSize - 1);
    const contentLength = finalEnd - start + 1;

    // Stream part from S3
    const s3Stream = s3.getObject({
      Bucket: bucketName,
      Key: content.s3Key,
      Range: `bytes=${start}-${finalEnd}`,
    }).createReadStream();

    // Set response headers
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${finalEnd}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': contentLength,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-cache',
    });

    // Handle stream errors
    s3Stream.on('error', (err) => {
      console.error(`S3 stream error for range bytes=${start}-${finalEnd}:`, err);
      if (!res.headersSent) {
        res.status(500).send('Stream failed');
      }
    });

    // Pipe the stream to the response
    s3Stream.pipe(res);

    // Log stream completion
    res.on('finish', () => {
      console.log(`Stream completed for content ID: ${contentId}, bytes=${start}-${finalEnd}, took ${Date.now() - startTime}ms`);
    });
  } catch (err) {
    console.error('Stream error:', err);
    if (!res.headersSent) {
      res.status(500).send('Stream failed');
    }
  }
});

//api with encryption

// Upload API
// app.post('/api/upload', async (req, res) => {
// //   if (req.user.role !== 'admin') {
// //     return res.status(403).json({ error: 'Forbidden' });
// //   }

//   try {
//     const key = crypto.randomBytes(32); // AES-256 key
//     const iv = crypto.randomBytes(16);
//     const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);

//     // Initiate multipart upload
//     const createRes = await s3.createMultipartUpload({
//       Bucket: bucketName,
//       Key: `videos/${Date.now()}.enc`,
//     }).promise();

//     const uploadId = createRes.UploadId;
//     const parts = [];
//     let partNumber = 1;
//     const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
//     let buffer = Buffer.alloc(0);

//     for await (const chunk of req) {
//       buffer = Buffer.concat([buffer, chunk]);

//       while (buffer.length >= CHUNK_SIZE) {
//         const piece = buffer.subarray(0, CHUNK_SIZE);
//         buffer = buffer.subarray(CHUNK_SIZE);

//         const encrypted = cipher.update(piece);

//         const uploadRes = await s3.uploadPart({
//           Bucket: bucketName,
//           Key: createRes.Key,
//           UploadId: uploadId,
//           PartNumber: partNumber,
//           Body: encrypted,
//         }).promise();

//         parts.push({ ETag: uploadRes.ETag, PartNumber: partNumber });
//         partNumber++;
//       }
//     }

//     // Handle leftover buffer
//     if (buffer.length > 0) {
//       const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
//       const uploadRes = await s3.uploadPart({
//         Bucket: bucketName,
//         Key: createRes.Key,
//         UploadId: uploadId,
//         PartNumber: partNumber,
//         Body: encrypted,
//       }).promise();

//       parts.push({ ETag: uploadRes.ETag, PartNumber: partNumber });
//     }

//     // Complete multipart upload
//     await s3.completeMultipartUpload({
//       Bucket: bucketName,
//       Key: createRes.Key,
//       UploadId: uploadId,
//       MultipartUpload: { Parts: parts },
//     }).promise();

//     // Save metadata in MongoDB
//     const content = new Content({
//       title: 'Multipart Video',
//       s3Key: createRes.Key,
//       iv: iv.toString('hex'),
//       key: key.toString('hex'),
//       allowedRoles: ['parent', 'child'],
//     });
//     await content.save();

//     res.json({ contentId: content._id });
//   } catch (error) {
//     console.error('Upload error:', error);
//     res.status(500).json({ error: 'Upload failed' });
//   }
// });

// Content streaming API
// app.get('/api/content/:id', async (req, res,next) => {
//   try {
//     const content = await Content.findById(req.params.id);
//     if (!content) return res.status(404).json({ error: 'Content not found' });

//     // // Check if user role is allowed
//     // if (!content.allowedRoles.includes(req.user.role)) {
//     //     return res.status(403).json({ error: 'Forbidden' });
//     // }
//     // console.log('Requested content:', content);

//    // Get object metadata
//     let headRes;
//     try {
//       headRes = await s3.headObject({
//         Bucket: bucketName,
//         Key: content.s3Key,
//       }).promise();
//     } catch (err) {
//       console.error(`S3 headObject error for key ${content.s3Key}:`, err);
//       return res.status(500).json({ error: 'Failed to access S3 object', details: err.message });
//     }
//     const totalSize = headRes.ContentLength;
//     console.log(`Total file size: ${totalSize} bytes`);

//     // Create S3 stream for the entire file
//     const s3Stream = s3.getObject({
//       Bucket: bucketName,
//       Key: content.s3Key,
//     }).createReadStream();

//     // Create decipher
//     const decipher = crypto.createDecipheriv(
//       'aes-256-ctr',
//       Buffer.from(content.key, 'hex'),
//       Buffer.from(content.iv, 'hex')
//     );
//     decipher.setAutoPadding(false);

//     const decryptedStream = s3Stream.pipe(decipher);

//     // Set response headers for the entire file
//     res.writeHead(200, {
//       'Content-Type': 'video/mp4',
//       'Content-Length': totalSize,
//       'Accept-Ranges': 'none', // Indicate no range support
//       'Cache-Control': 'no-cache',
//     });

//     // Handle stream errors
//     s3Stream.on('error', (err) => {
//       console.error(`S3 stream error:`, err);
//       if (!res.headersSent) {
//         res.status(500).json({ error: 'S3 stream failed', details: err.message });
//       }
//     });
//     decipher.on('error', (err) => {
//       console.error('Decryption error:', err);
//       if (!res.headersSent) {
//         res.status(500).json({ error: 'Decryption failed', details: err.message });
//       }
//     });
//     decryptedStream.on('error', (err) => {
//       console.error('Decrypted stream error:', err);
//       if (!res.headersSent) {
//         res.status(500).json({ error: 'Stream processing failed', details: err.message });
//       }
//     });

//     // Pipe the stream to the response
//     decryptedStream.pipe(res);

//     // Log stream completion
//     res.on('finish', () => {
//       console.log(`Stream completed for content ID: ${req.params.id}, full file`);
//     });
//   } catch (error) {
//     console.error('Content streaming error:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });

module.exports = app;