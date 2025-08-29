// routes/contentRoutes.js
const express = require('express');
const router = express.Router();
const { uploadContent, streamContent,getAllContent } = require('../controller/contentController');
const { authenticateJWT } = require('../controller/userController');

router.post('/upload', authenticateJWT, uploadContent);
router.get('/stream/:id', streamContent);
router.get('/content', getAllContent);

module.exports = router;
