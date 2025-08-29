const mongoose = require("mongoose");

const contentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  s3Key: {
    type: String,
    required: true,
  },
//   iv: {
//     type: String,
//     required: true, // stored in hex
//   },
//   key: {
//     type: String,
//     required: true, // stored in hex (⚠️ in real apps, use KMS or vault)
//   },
 
  allowedRoles: {
    type: [String],
    enum: ["parent", "child", "admin", "other"],
    default: ["parent", "child"],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Content = mongoose.model("Content", contentSchema);

module.exports = Content;
