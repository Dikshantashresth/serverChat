const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema({
  roomName: { type: String, required: true },
  password: { type: String, required: true }, 
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user'
  }],
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user'
  }]
}, {
  timestamps: true,
  collection: 'rooms'
});

const RoomModel = mongoose.model('Room', RoomSchema);
module.exports = RoomModel;
