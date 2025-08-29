const express = require('express');
const cors = require('cors');
const app = express();
const jwt = require('jsonwebtoken');
const redis = require('redis');

const userRoutes = require('./routes/userRoutes');
const contentRoutes = require('./routes/contentRoutes');


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


app.use('/api', userRoutes);

app.use('/api', contentRoutes);

module.exports = app;