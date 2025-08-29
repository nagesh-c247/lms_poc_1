// redisClient.js
const redis = require('redis');

const redisClient = redis.createClient({
  url: 'redis://localhost:6379', // Change if needed
});

redisClient.on('error', (err) => {
  console.error('Redis error:', err);
});

redisClient.connect();

module.exports = redisClient;
