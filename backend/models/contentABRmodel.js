const mongoose = require('mongoose');


const ContentSchema = new mongoose.Schema({
title: { type: String, required: true },
originalS3Path: { type: String },
s3Path: { type: String }, // base output path, e.g. outputs/movie1/clear/
renditions: { type: [String], default: [] },
manifestHls: { type: String },
manifestDash: { type: String },
allowedRoles: { type: [String], default: ['parent','child','admin'] },
status: {
type: String,
enum: ['uploaded','processing','completed','failed'],
default: 'uploaded'
},
createdAt: { type: Date, default: Date.now },
updatedAt: { type: Date, default: Date.now }
});


ContentSchema.pre('save', function(next) {
this.updatedAt = Date.now();
next();
});


module.exports = mongoose.model('ContentABR', ContentSchema);