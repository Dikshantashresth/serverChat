const mongoose = require("mongoose");

const userschema = new mongoose.Schema(
  {
    username: { type: String, unique: true },
    password: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "user" }
);

const userModel = mongoose.model("user", userschema);
module.exports = userModel;
