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
const ContentABR = require('../models/contentABRmodel'); // adjust path
const redisClient = require("../configs/redisClient"); // singleton redis client

const bucketName = process.env.S3_BUCKET || 'lms-poc-c247';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';
const bucketNameABR = process.env.S3_BUCKET_ABR || 'lms-poc-abr-c247';

const { getProducer,connectProducer } = require('../configs/kafka'); // adjust path

(async () => {
  try {
    await connectProducer();
  } catch (err) {
    console.error("Kafka producer connection error:", err);
  }
})();
const producer = getProducer();
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
exports.getAllContentabr = async (req, res) => {
  try {
    const contents = await ContentABR.find({});
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


// ======================================================ABR Upload Controller
// ======================================================

exports.uploadContentABR=async (req, res) => {
 try {
    if (req.user.role !== "admin") return res.status(403).send("Forbidden");

    const filename = req.headers["x-file-name"];
    console.log("Upload request by user:", req.user);

    // Temp file
    const tempInputFile = path.join(os.tmpdir(), `input-${Date.now()}.mp4`);

    // Step 1: Save incoming request stream to temp file
    const writeStream = fssync.createWriteStream(tempInputFile);
    for await (const chunk of req) {
      writeStream.write(chunk);
    }
    writeStream.end();
    await new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    // Step 2: Upload original file to S3 (multipart)
    const createRes = await s3
      .createMultipartUpload({
        Bucket: bucketNameABR,
        Key: `original/${Date.now()}-${filename}`,
      })
      .promise();

    const uploadId = createRes.UploadId;
    const parts = [];
    let partNumber = 1;

    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
    const fileBuffer = await fs.readFile(tempInputFile);
    let start = 0;

    while (start < fileBuffer.length) {
      const end = Math.min(start + CHUNK_SIZE, fileBuffer.length);
      const piece = fileBuffer.subarray(start, end);

      const uploadRes = await s3
        .uploadPart({
          Bucket: bucketNameABR,
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

    await s3
      .completeMultipartUpload({
        Bucket: bucketNameABR,
        Key: createRes.Key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      })
      .promise();

    // Step 3: Save metadata in DB
    const content = new ContentABR({
      title: filename,
      renditions: [], // will be updated after encoding
      originalS3Key: createRes.Key,
      s3Path: null, // filled after worker processes
      manifestHls: null,
      manifestDash: null,
      allowedRoles: ["parent", "child", "admin"],
      status: "uploaded",
    });
    await content.save();

    // Step 4: Send Kafka message to encoding worker
    await producer.send({
      topic: "video-encoding",
      messages: [
        {
          key: String(content._id),
          value: JSON.stringify({
            contentId: content._id,
            originalS3Key: createRes.Key,
            title: filename,
          }),
        },
      ],
    });

    // Step 5: Cleanup temp file
    await fs.unlink(tempInputFile).catch((err) =>
      console.error("Failed to delete temp file:", err)
    );

    res.json({
      contentId: content._id,
      originalS3Key: createRes.Key,
      status: content.status,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).send("Upload failed");
  }
}

exports.streamABRManifest = async (req, res) => {
  try {
    const { id: contentId } = req.params;
    const { type, rendition } = req.query;

    // Validate contentId
    

    // Fetch content from MongoDB
    const content = await ContentABR.findById(contentId).lean();
    if (!content) {
      return res.status(404).send('Content not found');
    }

    // Check if content is ready
    if (content.status !== 'ready') {
      return res.status(400).send(`Content is not ready. Current status: ${content.status}`);
    }

    // Determine manifest key and content type
    let manifestKey;
    let contentType;

    if (rendition) {
      // Stream rendition-specific manifest (e.g., outputs/<contentId>/1080p/1080p.m3u8)
      if (!['1080p', '720p', '480p'].includes(rendition)) {
        return res.status(400).send('Invalid rendition. Must be 1080p, 720p, or 480p');
      }
      if (!content.renditions.includes(rendition)) {
        return res.status(404).send(`Rendition ${rendition} not available for this content`);
      }
      manifestKey = `outputs/${contentId}/${rendition}/${rendition}.m3u8`;
      contentType = 'application/vnd.apple.mpegurl';
    } else if (type) {
      // Stream master manifest (hls or dash)
      if (!['hls', 'dash'].includes(type.toLowerCase())) {
        return res.status(400).send('Query parameter "type" must be "hls" or "dash"');
      }
      manifestKey = type.toLowerCase() === 'hls' ? content.manifestHls : content.manifestDash;
      contentType = type.toLowerCase() === 'hls' ? 'application/vnd.apple.mpegurl' : 'application/dash+xml';
    } else {
      // Default to 1080p rendition manifest
      if (!content.renditions.includes('1080p')) {
        return res.status(404).send('1080p rendition not available for this content');
      }
      manifestKey = `outputs/${contentId}/1080p/1080p.m3u8`;
      contentType = 'application/vnd.apple.mpegurl';
    }

    // Get S3 object metadata
    let headRes;
    try {
      headRes = await s3
        .headObject({ Bucket: bucketNameABR, Key: manifestKey })
        .promise();
    } catch (err) {
      console.error(`❌ S3 headObject error for ${manifestKey}: ${err.message}`);
      return res.status(404).send(`Manifest not found: ${manifestKey}`);
    }

    const fileSize = headRes.ContentLength;

    // Handle range request
    const range = req.headers.range;
    if (!range) {
      // No range header: stream entire file
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      });

      const s3Stream = s3
        .getObject({ Bucket: bucketNameABR, Key: manifestKey })
        .createReadStream();

      s3Stream.on('error', (err) => {
        console.error(`❌ S3 stream error for ${manifestKey}: ${err.message}`);
        if (!res.headersSent) res.status(500).send('Stream failed');
      });

      s3Stream.pipe(res);
      return;
    }

    // Parse range header
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return res.status(416).send('Invalid range header');
    }

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      return res.status(416).send('Requested range not satisfiable');
    }

    const contentLength = end - start + 1;

    // Stream with range
    const s3Stream = s3
      .getObject({
        Bucket: bucketNameABR,
        Key: manifestKey,
        Range: `bytes=${start}-${end}`,
      })
      .createReadStream();

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': contentLength,
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });

    s3Stream.on('error', (err) => {
      console.error(`❌ S3 stream error for ${manifestKey}: ${err.message}`);
      if (!res.headersSent) res.status(500).send('Stream failed');
    });

    s3Stream.pipe(res);
  } catch (err) {
    console.error(`❌ ABR stream error: ${err.message}`);
    if (!res.headersSent) res.status(500).send('Internal server error');
  }
};

// exports.getABRManifests = async (req, res) => {
//   try {
//     console.log("Fetching ABR manifests for contentId:", req.params.id);
//     const contentId = req.params.id;
//     const sessionId = req.query.session;
//     const authHeader = req.headers.authorization;
//     const token =
//       req.query.token ||
//       (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null);

//     let role, exp;

//     // Load metadata (Redis → Mongo fallback)
//     const contentCacheKey = `content:${contentId}`;
//     let contentData = await redisClient.get(contentCacheKey);

//     let content;
//     if (contentData) {
//       content = JSON.parse(contentData);
//     } else {
//       content = await ContentABR.findById(contentId).lean();
//       if (!content) return res.status(404).send('Not found');
//       await redisClient.setEx(contentCacheKey, 3600, JSON.stringify(content));
//     }

//     // Session handling
//     if (sessionId) {
//       const sessionKey = `session:${sessionId}`;
//       const sessionData = await redisClient.get(sessionKey);

//       if (sessionData) {
//         const session = JSON.parse(sessionData);
//         const nowSeconds = Math.floor(Date.now() / 1000);

//         if (session.contentId !== contentId)
//           return res.status(403).send('Forbidden');

//         if (nowSeconds >= session.exp) {
//           // Expired session
//           if (!token) {
//             res.setHeader('x-session-expired', 'true');
//             return res.status(440).send('Session expired');
//           }

//           let decoded;
//           try {
//             decoded = jwt.verify(token, process.env.JWT_SECRET);
//             console.log("Decoded token:", decoded);
//           } catch (err) {
//             await redisClient.del(sessionKey);
//             return res.status(401).send('Invalid or expired token');
//           }

//           ({ role, exp } = await createSession(decoded, contentId, res));
//         } else {
//           role = session.role;
//           exp = session.exp;
//           const remainingSeconds = exp - nowSeconds;
//           await redisClient.expire(
//             sessionKey,
//             Math.min(10, remainingSeconds)
//           );
//         }
//       } else {
//         // No session
//         if (!token) {
//           res.setHeader('x-session-expired', 'true');
//           return res.status(440).send('Session expired');
//         }

//         let decoded;
//         try {
//           decoded = jwt.verify(token, process.env.JWT_SECRET);
//         } catch (err) {
//           return res.status(401).send('Invalid or expired token');
//         }

//         ({ role, exp } = await createSession(decoded, contentId, res));
//       }
//     } else {
//       // No session at all
//       if (!token) return res.status(401).send('Unauthorized');

//       let decoded;
//       try {
//         decoded = jwt.verify(token, process.env.JWT_SECRET);
//         console.log("Decoded token:", decoded);
//       } catch (err) {
//         return res.status(401).send('Invalid or expired token');
//       }

//       ({ role, exp } = await createSession(decoded, contentId, res));
//     }

//     // Role check
//     if (!content.allowedRoles.includes(role))
//       return res.status(403).send('Forbidden');

//     // Check if content is ready
//     if (content.status !== 'ready') {
//       return res.status(400).send(`Content is not ready. Current status: ${content.status}`);
//     }

//     // Generate direct S3 URLs for manifests
//     const hlsUrl = `${S3_BASE_URL}/${content.manifestHls}`;
//     const dashUrl = `${S3_BASE_URL}/${content.manifestDash}`;

//     // Return response
//     res.status(200).json({
//       contentId,
//       status: content.status,
//       renditions: content.renditions,
//       hlsUrl,
//       dashUrl,
//     });
//   } catch (err) {
//     console.error(`❌ ABR manifest error: ${err.message}`);
//     if (!res.headersSent) res.status(500).send('Internal server error');
//   }
// };