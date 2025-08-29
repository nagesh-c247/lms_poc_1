const mongoose=require('mongoose')

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'parent' }, // parent/child/admin/etc
  createdAt: { type: Date, default: Date.now }
});

module.exports=mongoose.model('User',userSchema)