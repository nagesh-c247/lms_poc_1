// routes/userRoutes.js
const express = require('express');
const router = express.Router();

userController=require("../controller/userController")
router.post('/signin', userController.signIn);
router.post('/signup', userController.signUp);
router.post('/logout', userController.authenticateJWT, userController.logout);

module.exports = router;
