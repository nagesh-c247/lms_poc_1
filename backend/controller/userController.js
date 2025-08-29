// controllers/userController.js
const jwt = require('jsonwebtoken');
const User = require('../models/userModel'); // adjust path
const redisClient = require("../configs/redisClient"); // adjust path
// const bcrypt = require('bcrypt'); // uncomment when you add hashing

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';
const JWT_EXPIRES_IN = '1h'; // 1 hour

// ================= Middleware =================
exports.authenticateJWT = (req, res, next) => {
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
};

// Helper function to sign JWT for a user
function signJwtForUser(user) {
   const payload = {
      sub: String(user._id),
      email: user.email,
      role: user.role,
    };
    return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN });
}

// ================= APIs =================
exports.signIn = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // TODO: Replace with bcrypt
    // const validPassword = await bcrypt.compare(password, user.passwordHash);
    // if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signJwtForUser(user);
    res.json({ token, user });
  } catch (err) {
    console.error('Sign-in error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.signUp = async (req, res) => {
  const { email, password } = req.body;
  try {
    // TODO: Replace with bcrypt
    // const passwordHash = await bcrypt.hash(password, 10);
    const passwordHash = password;

    const newUser = new User({ email: email.toLowerCase().trim(), passwordHash });
    await newUser.save();
    res.json({ message: 'User created successfully' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    console.error('Sign-up error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.logout = async (req, res) => {
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
};
