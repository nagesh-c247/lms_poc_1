// controllers/contentController.js
const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const jwt = require('jsonwebtoken');

const s3 = require('../configs/awsConf'); // adjust path
const Content = require('../models/contentModel'); // adjust path
const redisClient = require("../configs/redisClient"); // singleton redis client

const bucketName = process.env.S3_BUCKET || 'lms-poc-c247';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';

// 🔹 Create session helper
async function createSession(decoded, contentId, res) {
  const role = decoded.role;
  const exp = decoded.exp;

  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(300, exp - now);

  const newSessionId = uuidv4();
  await redisClient.setEx(
    `session:${newSessionId}`,
    ttl,
    JSON.stringify({ role, contentId, exp })
  );

  res.setHeader('x-session-id', newSessionId);
  return { role, exp };
}

exports.getAllContent = async (req, res) => {
  try {
    const contents = await Content.find({});
    res.status(200).json({ contents });
  } catch (err) {
    console.error('Get contents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ======================================================
// 🔹 Upload Controller
// ======================================================
exports.uploadContent = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).send('Forbidden');

    const filename = req.headers['x-file-name'];
    console.log('Upload request by user:', req.user);

    // Temp files
    const tempInputFile = path.join(os.tmpdir(), `input-${Date.now()}.mp4`);
    const tempOutputFile = path.join(os.tmpdir(), `output-${Date.now()}.mp4`);

    // Step 1: Save incoming chunks
    const writeStream = fssync.createWriteStream(tempInputFile);
    for await (const chunk of req) {
      writeStream.write(chunk);
    }
    writeStream.end();
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Step 2: FFmpeg processing
    await new Promise((resolve, reject) => {
      ffmpeg(tempInputFile)
        .videoCodec('libx264')
        .audioCodec('aac')
        .format('mp4')
        .outputOptions(['-movflags faststart', '-preset fast', '-crf 23'])
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

    // Step 3: Initiate multipart upload
    const createRes = await s3
      .createMultipartUpload({
        Bucket: bucketName,
        Key: `videos/${Date.now()}.mp4`,
      })
      .promise();

    const uploadId = createRes.UploadId;
    const parts = [];
    let partNumber = 1;

    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
    const fileBuffer = await fs.readFile(tempOutputFile);
    let start = 0;

    // Step 4: Upload parts
    while (start < fileBuffer.length) {
      const end = Math.min(start + CHUNK_SIZE, fileBuffer.length);
      const piece = fileBuffer.subarray(start, end);

      const uploadRes = await s3
        .uploadPart({
          Bucket: bucketName,
          Key: createRes.Key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: piece,
        })
        .promise();

      parts.push({ ETag: uploadRes.ETag, PartNumber: partNumber });
      partNumber++;
      start += CHUNK_SIZE;
    }

    // Step 5: Complete multipart upload
    await s3
      .completeMultipartUpload({
        Bucket: bucketName,
        Key: createRes.Key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      })
      .promise();

    // Step 6: Save metadata
    const content = new Content({
      title: filename,
      s3Key: createRes.Key,
      allowedRoles: ['parent', 'child', 'admin'],
    });
    await content.save();

    // Step 7: Cleanup
    await Promise.all([
      fs.unlink(tempInputFile).catch((err) =>
        console.error('Failed to delete input file:', err)
      ),
      fs.unlink(tempOutputFile).catch((err) =>
        console.error('Failed to delete output file:', err)
      ),
    ]);

    res.json({ contentId: content._id, key: createRes.Key });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).send('Upload failed');
  }
};

// ======================================================
// 🔹 Stream Controller
// ======================================================
exports.streamContent = async (req, res) => {
  try {

    const contentId = req.params.id;
    const sessionId = req.query.session;
    const authHeader = req.headers.authorization;
    const token =
      req.query.token ||
      (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null);

    let role, content, exp;

    // Load metadata (Redis → Mongo fallback)
    const contentCacheKey = `content:${contentId}`;
    let contentData = await redisClient.get(contentCacheKey);

    if (contentData) {
      content = JSON.parse(contentData);
    } else {
      content = await Content.findById(contentId).lean();
      if (!content) return res.status(404).send('Not found');
      await redisClient.setEx(contentCacheKey, 3600, JSON.stringify(content));
    }

    // Session handling
    if (sessionId) {
      const sessionKey = `session:${sessionId}`;
      const sessionData = await redisClient.get(sessionKey);

      if (sessionData) {
        const session = JSON.parse(sessionData);
        const nowSeconds = Math.floor(Date.now() / 1000);

        if (session.contentId !== contentId)
          return res.status(403).send('Forbidden');

        if (nowSeconds >= session.exp) {
          // expired
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

          ({ role, exp } = await createSession(decoded, contentId, res));
        } else {
          role = session.role;
          exp = session.exp;
          const remainingSeconds = exp - nowSeconds;
          await redisClient.expire(
            sessionKey,
            Math.min(10, remainingSeconds)
          );
        }
      } else {
        // no session
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

        ({ role, exp } = await createSession(decoded, contentId, res));
      }
    } else {
      // no session at all
      if (!token) return res.status(401).send('Unauthorized');

      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch (err) {
        return res.status(401).send('Invalid or expired token');
      }

      ({ role, exp } = await createSession(decoded, contentId, res));
    }

    // Role check
    if (!content.allowedRoles.includes(role))
      return res.status(403).send('Forbidden');

    // Range
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

    // Stream from S3
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
};
