// routes/contentRoutes.js
const express = require('express');
const router = express.Router();
const { uploadContent, streamContent,getAllContent,getAllContentabr,uploadContentABR,streamABRManifest } = require('../controller/contentController');
const { authenticateJWT } = require('../controller/userController');
const ContentABR=require('../models/contentABRmodel')
const s3 = require('../configs/awsConf');
const mongoose = require('mongoose');
const bucketNameABR = 'lms-poc-abr-c247';
const stream = require('stream');
const { v4: uuidv4 } = require('uuid');
const redisClient = require("../configs/redisClient"); // singleton redis client
router.post('/upload', authenticateJWT, uploadContent);
router.get('/stream/:id', streamContent);
router.get('/content', getAllContent);
router.get('/contentabr', getAllContentabr);
router.post('/uploadabr',authenticateJWT, uploadContentABR);
const jwt = require('jsonwebtoken');


const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';

// router.get('/streamabr/:id', streamABRManifest);
// router.use('/streamabr', async (req, res, next) => {
//   if (req.method !== 'GET') return next();

//   try {
//     const path = req.path.substring(1); // e.g., '68b7ec36df17b470a9e8609e' or 'outputs/68b7ec36df17b470a9e8609e/1080p/1080p.m3u8'
//     const { type } = req.query;
//     let manifestKey;
//     let contentType;
//     let isMasterManifest = false;

//     console.log(`Streaming request: path=${path}, query=${JSON.stringify(req.query)}`);

//     // Handle master manifest request
//     if (path.match(/^[^/]+$/) && path !== '') {
//       const contentId = path;
//       const content = await ContentABR.findById(contentId).lean();
//       if (!content) {
//         return res.status(404).send('Content not found');
//       }
//       if (content.status !== 'ready') {
//         return res.status(400).send(`Content is not ready. Current status: ${content.status}`);
//       }
//       if (!type || !['hls', 'dash'].includes(type.toLowerCase())) {
//         return res.status(400).send('Query parameter "type" must be "hls" or "dash"');
//       }
//       manifestKey = type.toLowerCase() === 'hls' ? `manifests/${contentId}.m3u8` : `manifests/${contentId}.mpd`;
//       contentType = type.toLowerCase() === 'hls' ? 'application/vnd.apple.mpegurl' : 'application/dash+xml';
//       isMasterManifest = true;
//     }
//     // Handle variant playlists and segments
//     else if (path.match(/^outputs\/([^/]+)\/([^/]+)\/(.+)$/)) {
//       const [, contentId, rendition, file] = path.match(/^outputs\/([^/]+)\/([^/]+)\/(.+)$/);
//       const content = await ContentABR.findById(contentId).lean();
//       if (!content) {
//         return res.status(404).send('Content not found');
//       }
//       if (content.status !== 'ready') {
//         return res.status(400).send(`Content is not ready. Current status: ${content.status}`);
//       }
//       // Validate rendition for .m3u8 files
//       const renditionName = rendition.toLowerCase(); // e.g., '1080p'
//       if (file.endsWith('.m3u8') && ['1080p', '720p', '480p'].includes(renditionName) && !content.renditions.includes(renditionName)) {
//         return res.status(404).send(`Rendition ${renditionName} not available for this content`);
//       }
//       manifestKey = `outputs/${contentId}/${rendition}/${file}`;
//       contentType = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4';
//     } else {
//       return res.status(400).send('Invalid request path');
//     }

//     // Get S3 object metadata
//     let headRes;
//     try {
//       headRes = await s3.headObject({ Bucket: bucketNameABR, Key: manifestKey }).promise();
//     } catch (err) {
//       console.error(`❌ S3 headObject error for ${manifestKey}: ${err.message}`);
//       return res.status(404).send(`File not found: ${manifestKey}`);
//     }

//     const fileSize = headRes.ContentLength;
//     const range = req.headers.range;

//     // Set common headers
//     const headers = {
//       'Content-Type': contentType,
//       'Cache-Control': 'no-cache',
//       'Accept-Ranges': 'bytes',
//       'X-Content-Type-Options': 'nosniff',
//       'X-Amz-Request-Id': headRes.RequestId || 'unknown'
//     };

//     // Handle master manifest: rewrite S3 URLs to API URLs
//     if (isMasterManifest && contentType === 'application/vnd.apple.mpegurl') {
//       const s3Object = await s3.getObject({ Bucket: bucketNameABR, Key: manifestKey }).promise();
//       let manifestContent = s3Object.Body.toString('utf-8');

//       // Rewrite S3 URLs to API URLs
//       const s3UrlPattern = /https:\/\/lms-poc-abr-c247\.s3\.amazonaws\.com\/(outputs\/[^/]+\/[^/]+\/[^/]+\.m3u8)/g;
//       manifestContent = manifestContent.replace(
//         s3UrlPattern,
//         (match, path) => `${req.protocol}://${req.get('host')}/api/streamabr/${path}`
//       );

//       console.log(`Rewritten manifest: ${manifestContent}`);

//       const manifestBuffer = Buffer.from(manifestContent, 'utf-8');
//       headers['Content-Length'] = manifestBuffer.length;

//       if (!range) {
//         res.writeHead(200, headers);
//         const passThrough = new stream.PassThrough();
//         passThrough.write(manifestBuffer);
//         passThrough.end();
//         passThrough.pipe(res);
//         return;
//       }

//       // Handle range request for master manifest
//       const match = range.match(/bytes=(\d+)-(\d*)/);
//       if (!match) {
//         return res.status(416).send('Invalid range header');
//       }
//       const start = parseInt(match[1], 10);
//       const end = match[2] ? parseInt(match[2], 10) : manifestBuffer.length - 1;
//       if (start >= manifestBuffer.length || end >= manifestBuffer.length) {
//         return res.status(416).send(`Requested range not satisfiable: bytes ${start}-${end}/${manifestBuffer.length}`);
//       }
//       const contentLength = end - start + 1;
//       headers['Content-Range'] = `bytes ${start}-${end}/${manifestBuffer.length}`;
//       headers['Content-Length'] = contentLength;
//       res.writeHead(206, headers);
//       const passThrough = new stream.PassThrough();
//       passThrough.write(manifestBuffer.slice(start, end + 1));
//       passThrough.end();
//       passThrough.pipe(res);
//       return;
//     }

//     // Stream other files (variant playlists, segments)
//     if (!range) {
//       headers['Content-Length'] = fileSize;
//       res.writeHead(200, headers);
//       const s3Stream = s3.getObject({ Bucket: bucketNameABR, Key: manifestKey }).createReadStream();
//       s3Stream.on('error', (err) => {
//         console.error(`❌ S3 stream error for ${manifestKey}: ${err.message}`);
//         if (!res.headersSent) res.status(500).send('Stream failed');
//       });
//       s3Stream.pipe(res);
//       return;
//     }

//     // Handle range request
//     const match = range.match(/bytes=(\d+)-(\d*)/);
//     if (!match) {
//       return res.status(416).send('Invalid range header');
//     }
//     const start = parseInt(match[1], 10);
//     const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
//     if (start >= fileSize || end >= fileSize) {
//       return res.status(416).send(`Requested range not satisfiable: bytes ${start}-${end}/${fileSize}`);
//     }
//     const contentLength = end - start + 1;
//     headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
//     headers['Content-Length'] = contentLength;
//     res.writeHead(206, headers);
//     const s3Stream = s3
//       .getObject({ Bucket: bucketNameABR, Key: manifestKey, Range: `bytes=${start}-${end}` })
//       .createReadStream();
//     s3Stream.on('error', (err) => {
//       console.error(`❌ S3 stream error for ${manifestKey}: ${err.message}`);
//       if (!res.headersSent) res.status(500).send('Stream failed');
//     });
//     s3Stream.pipe(res);
//   } catch (err) {
//     console.error(`❌ Stream error: ${err.message}`);
//     if (!res.headersSent) res.status(500).send('Internal server error');
//   }
// });
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
router.use('/streamabr', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  try {
    const path = req.path.substring(1); // e.g., '68b7ec36df17b470a9e8609e' or 'outputs/68b7ec36df17b470a9e8609e/1080p/1080p.m3u8'
    const { type } = req.query;
    let manifestKey;
    let contentType;
    let isMasterManifest = false;

    // console.log(`Streaming request: path=${path}, query=${JSON.stringify(req.query)}`);

    // Extract contentId
    let contentId;
    if (path.match(/^[^/]+$/) && path !== '') {
      contentId = path;
      isMasterManifest = true;
    } else if (path.match(/^outputs\/([^/]+)\/([^/]+)\/(.+)$/)) {
      const [, id] = path.match(/^outputs\/([^/]+)/);
      contentId = id;
    } else {
      return res.status(400).send('Invalid request path');
    }

    // Load metadata (Redis → Mongo fallback)
    const contentCacheKey = `contentabr:${contentId}`;
    let contentData = await redisClient.get(contentCacheKey);

    let content;
    if (contentData) {
      content = JSON.parse(contentData);
    } else {
      content = await ContentABR.findById(contentId).lean();
      if (!content) return res.status(404).send('Content not found');
      await redisClient.setEx(contentCacheKey, 3600, JSON.stringify(content));
    }

    if (content.status !== 'ready') {
      return res.status(400).send(`Content is not ready. Current status: ${content.status}`);
    }

    const sessionId = req.query.session;
    const authHeader = req.headers.authorization;

    // console.log(`Session ID: ${sessionId}, Auth Header: ${authHeader ? 'present' : 'absent'}`);
    const token =req.query.token
    console.log("asdfasdfsda",token)

    let role, exp;

    // Session handling
    if (sessionId) {
      const sessionKey = `session:${sessionId}`;
      const sessionData = await redisClient.get(sessionKey);
        console.log("Session Data:", sessionData);
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
            console.log("Decoded token after session expiry:", decoded);
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
          console.log("Token missing and no session found for sessionId:", sessionId);
          return res.status(440).send('Session expired');
        }
        console.log("Token present but no session found for sessionId:", sessionId);
        let decoded;
        try {
            console.log("Verifying token since no session found",token);
          decoded = jwt.verify(token, JWT_SECRET);
          console.log("Decoded token when no session found:", decoded);
        } catch (err) {
            console.log("JWT verification failed:", err.message);
          return res.status(401).send('Invalid or expired token');
        }

        ({ role, exp } = await createSession(decoded, contentId, res));
      }
    } else {
        // console.log(token);
      // no session at all
      if (!token) return res.status(401).send('Unauthorized');

      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
        console.log("Decoded token without session:", decoded);
      } catch (err) {
        return res.status(401).send('Invalid or expired token');
      }

      ({ role, exp } = await createSession(decoded, contentId, res));
    }

    // Role check
    if (!content.allowedRoles.includes(role))
      return res.status(403).send('Forbidden');

    // Handle master manifest request
    if (isMasterManifest) {
      if (!type || !['hls', 'dash'].includes(type.toLowerCase())) {
        return res.status(400).send('Query parameter "type" must be "hls" or "dash"');
      }
      manifestKey = type.toLowerCase() === 'hls' ? `manifests/${contentId}.m3u8` : `manifests/${contentId}.mpd`;
      contentType = type.toLowerCase() === 'hls' ? 'application/vnd.apple.mpegurl' : 'application/dash+xml';
    }
    // Handle variant playlists and segments
    else {
      const [, , rendition, file] = path.match(/^outputs\/([^/]+)\/([^/]+)\/(.+)$/);
      const renditionName = rendition.toLowerCase(); // e.g., '1080p'
      if (file.endsWith('.m3u8') && ['1080p', '720p', '480p'].includes(renditionName) && !content.renditions.includes(renditionName)) {
        return res.status(404).send(`Rendition ${renditionName} not available for this content`);
      }
      manifestKey = `outputs/${contentId}/${rendition}/${file}`;
      contentType = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4';
    }

    // Get S3 object metadata
    let headRes;
    try {
      headRes = await s3.headObject({ Bucket: bucketNameABR, Key: manifestKey }).promise();
    } catch (err) {
      console.error(`❌ S3 headObject error for ${manifestKey}: ${err.message}`);
      return res.status(404).send(`File not found: ${manifestKey}`);
    }

    const fileSize = headRes.ContentLength;
    const range = req.headers.range;

    // Set common headers
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'X-Amz-Request-Id': headRes.RequestId || 'unknown'
    };

    // Handle master manifest: rewrite S3 URLs to API URLs
    if (isMasterManifest && contentType === 'application/vnd.apple.mpegurl') {
      const s3Object = await s3.getObject({ Bucket: bucketNameABR, Key: manifestKey }).promise();
      let manifestContent = s3Object.Body.toString('utf-8');

      // Rewrite S3 URLs to API URLs
      const s3UrlPattern = /https:\/\/lms-poc-abr-c247\.s3\.amazonaws\.com\/(outputs\/[^/]+\/[^/]+\/[^/]+\.m3u8)/g;
      manifestContent = manifestContent.replace(
        s3UrlPattern,
        (match, path) => `${req.protocol}://${req.get('host')}/api/streamabr/${path}`
      );

      console.log(`Rewritten manifest: ${manifestContent}`);

      const manifestBuffer = Buffer.from(manifestContent, 'utf-8');
      headers['Content-Length'] = manifestBuffer.length;

      if (!range) {
        res.writeHead(200, headers);
        const passThrough = new stream.PassThrough();
        passThrough.write(manifestBuffer);
        passThrough.end();
        passThrough.pipe(res);
        return;
      }

      // Handle range request for master manifest
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        return res.status(416).send('Invalid range header');
      }
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : manifestBuffer.length - 1;
      if (start >= manifestBuffer.length || end >= manifestBuffer.length) {
        return res.status(416).send(`Requested range not satisfiable: bytes ${start}-${end}/${manifestBuffer.length}`);
      }
      const contentLength = end - start + 1;
      headers['Content-Range'] = `bytes ${start}-${end}/${manifestBuffer.length}`;
      headers['Content-Length'] = contentLength;
      res.writeHead(206, headers);
      const passThrough = new stream.PassThrough();
      passThrough.write(manifestBuffer.slice(start, end + 1));
      passThrough.end();
      passThrough.pipe(res);
      return;
    }

    // Stream other files (variant playlists, segments)
    if (!range) {
      headers['Content-Length'] = fileSize;
      res.writeHead(200, headers);
      const s3Stream = s3.getObject({ Bucket: bucketNameABR, Key: manifestKey }).createReadStream();
      s3Stream.on('error', (err) => {
        console.error(`❌ S3 stream error for ${manifestKey}: ${err.message}`);
        if (!res.headersSent) res.status(500).send('Stream failed');
      });
      s3Stream.pipe(res);
      return;
    }

    // Handle range request
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return res.status(416).send('Invalid range header');
    }
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
    if (start >= fileSize || end >= fileSize) {
      return res.status(416).send(`Requested range not satisfiable: bytes ${start}-${end}/${fileSize}`);
    }
    const contentLength = end - start + 1;
    headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
    headers['Content-Length'] = contentLength;
    res.writeHead(206, headers);
    const s3Stream = s3
      .getObject({ Bucket: bucketNameABR, Key: manifestKey, Range: `bytes=${start}-${end}` })
      .createReadStream();
    s3Stream.on('error', (err) => {
      console.error(`❌ S3 stream error for ${manifestKey}: ${err.message}`);
      if (!res.headersSent) res.status(500).send('Stream failed');
    });
    s3Stream.pipe(res);
  } catch (err) {
    console.error(`❌ Stream error: ${err.message}`);
    if (!res.headersSent) res.status(500).send('Internal server error');
  }
});

module.exports = router;
