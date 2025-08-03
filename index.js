const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const cookieParser = require("cookie-parser");
const userModel = require("./models/user");
const MessageModel = require("./models/message");
const RoomModel = require("./models/rooms");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = require("http").createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://tempchat-eta.vercel.app",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const Key = process.env.SECRET_KEY;
const Url = process.env.MONGODB_URI;
const onlineUsers = new Map();
mongoose.connect(Url);

app.use(cors({ origin: "https://tempchat-eta.vercel.app", credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/test", (req, res) => res.json("test ok"));

app.get("/profile", (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json("no token");
  jwt.verify(token, Key, {}, (err, userdata) => {
    if (err) throw err;
    res.json(userdata);
  });
});

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(
      password,
      await bcrypt.genSalt(10)
    );
    const createdUser = await userModel.create({
      username,
      password: hashedPassword,
    });
    jwt.sign({ userId: createdUser._id, username }, Key, {}, (err, token) => {
      if (err) throw err;
      res
        .cookie("token", token, {
          httpOnly: true,
          sameSite: "none",
          secure: true,
        })
        .status(201)
        .json({ id: createdUser._id });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const founduser = await userModel.findOne({ username });
  if (!founduser) return res.status(400).json({ error: "unauthorized" });
  const result = await bcrypt.compare(password, founduser.password);
  if (!result) return res.status(400).json({ error: "unauthorized" });
  jwt.sign({ userId: founduser._id, username }, Key, {}, (err, token) => {
    if (err) throw err;
    res
      .cookie("token", token, {
        httpOnly: true,
        sameSite: "none", 
        secure: true, 
      })
      .status(201)
      .json({ id: founduser._id });
  });
});

io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("create_room", async (data) => {
    try {
      const { roomname, password, userid } = data;
      console.log("Looking for existing room:", roomname);
      const findRoom = await RoomModel.findOne({ roomName: roomname });
      if (findRoom) {
        return socket.emit("roomCreated", {
          status: false,
          error: "Room already exists",
        });
      }
      const hashedPassword = await bcrypt.hash(
        password,
        await bcrypt.genSalt(10)
      );
      const createdRoom = await RoomModel.create({
        roomName: roomname,
        password: hashedPassword,
        members: [userid],
        admins: [userid],
      });
      socket.join(roomname);
      console.log("Room created:", createdRoom);
      socket.emit("roomCreated", { status: true, room: createdRoom._id });
    } catch (err) {
      console.error(err);
      socket.emit("roomCreated", { status: false, error: "Server error" });
    }
  });

  socket.on("join_room", async (data) => {
    try {
      const { roomname, password, userid } = data;
      const objectId = new mongoose.Types.ObjectId(userid);

      const findRoom = await RoomModel.findOne({ roomName: roomname });
      if (!findRoom) return socket.emit("err", "Room is not available");

      const passwordMatch = await bcrypt.compare(password, findRoom.password);
      if (!passwordMatch) return socket.emit("err", "Incorrect credentials");

      const userExists = await userModel.exists({ _id: objectId });
      if (!userExists) return socket.emit("err", "User not found");

      // Join the socket room
      socket.join(roomname);
      console.log("User joined room:", roomname);

      const alreadyMember = findRoom.members.some((m) => m.equals(objectId));
      let updatedRoom;

      if (!alreadyMember) {
        updatedRoom = await RoomModel.findByIdAndUpdate(
          findRoom._id,
          { $push: { members: objectId } },
          { new: true }
        ).lean();
      } else {
        updatedRoom = findRoom;
      }
      console.log(updatedRoom);
      // Emit members list
      const populatedRoom = await RoomModel.findById(updatedRoom._id).populate(
        "members"
      );
      console.log(populatedRoom);
      socket.emit("members", {
        _id: populatedRoom._id,
        roomName: populatedRoom.roomName,
        members: populatedRoom.members,
      });

      socket.emit("roomjoined", {
        status: true,
        roomId: updatedRoom._id,
      });
    } catch (err) {
      console.error("join_room error:", err);
      socket.emit("err", "Server error during join");
    }
  });
  socket.on("join_existing_room", async ({roomId, username}) => {
    
    try {
      const room = await RoomModel.findById(roomId).populate("members");
      if (!room) return socket.emit("err", { message: "Room not found" });

      socket.join(room.roomName);
      console.log(`User re-entered room ${room.roomName}`);
      console.log(room);
      socket.emit("members", {
        _id: room._id,
        roomName: room.roomName,
        members: room.members,
      });
      if (!onlineUsers.has(username)) {
      onlineUsers.set(username, socket.id);
    }


    io.emit('joined', {
      status: true,
      user: username,
      onlineUsers: Array.from(onlineUsers.keys())
    });


  
    } catch (err) {
      console.error("enter_existing_room error:", err);
      socket.emit("err", { message: "Server error during re-entry" });
    }
  });
socket.on('disconnect', () => {
    // Remove user by socket id
    for (let [username, sockId] of onlineUsers.entries()) {
      if (sockId === socket.id) {
        onlineUsers.delete(username);
        // Notify others
        io.emit('left', {
          status: true,
          user: username,
          onlineUsers: Array.from(onlineUsers.keys())
        });
        break;
      }
    }

    console.log(`User disconnected: ${socket.id}`);
  });
  socket.on("send_message", async (msgData) => {
    const messageSend = await MessageModel.create({
      content: msgData.message,
      room: msgData.roomid,
      sender: msgData.id,
    });
    const populatemessage = await (
      await messageSend.populate("sender")
    ).populate("room");
    io.to(populatemessage.room.roomName).emit("get_message", populatemessage);
  });

  socket.on('user-joined', ({ roomId, userId }) => {
    socket.join(roomId);
    socket.to(roomId).emit('user-joined-announcement', { userId });
  });

  socket.on('user-left', ({ roomId, userId }) => {
    socket.leave(roomId);
    socket.to(roomId).emit('user-left-announcement', { userId });
  });
});

app.get("/messages", async (req, res) => {
  const roomId = req.query.roomId;
  try {
    const messages = await MessageModel.find({ room: roomId })
      .sort({ timestamp: 1 })
      .populate("sender");
    res.status(200).json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
app.delete("/delete/:roomid", async (req, res) => {
  const { roomid } = req.params;
  const objectId = new mongoose.Types.ObjectId(roomid);
  try {
    const roomExists = await RoomModel.exists({ _id: objectId });
    if (!roomExists) {
      return res.status(404).json({ err: "Room not Found", status: false });
    } else {
      const deletedRoom = await RoomModel.findByIdAndDelete(objectId);
      const deletedMessages = await MessageModel.deleteMany({ room: objectId });
      return res
        .status(200)
        .json({ status: true, message: "Room deleted sucessfully" });
    }
  } catch (err) {
    console.error("Error deleting room:", err);
    return res
      .status(500)
      .json({ err: "Internal Server Error", status: false });
  }
});

app.get("/leave/:roomid", async (req, res) => {
  const { roomid } = req.params;
  const {userId  } = req.query; // Extract userId from query parameters
  const objectId = new mongoose.Types.ObjectId(roomid);
  const userIdObject = new mongoose.Types.ObjectId(userId); // Convert userId to ObjectId
  try {
    const roomExists = await RoomModel.exists({ _id: objectId });
    if (!roomExists) {
      return res.status(404).json({ err: "Room not Found", status: false });
    } else {
      const updatedRoom = await RoomModel.findByIdAndUpdate(
        objectId,
        { $pull: { members: userIdObject } },
        { new: true }
      );
      return res
        .status(200)
        .json({ status: true, message: "Left the room sucessfully" });
    }
  } catch (err) {
    console.error("Error leaving room:", err);
    return res
      .status(500)
      .json({ err: "Internal Server Error", status: false });
  }
});
app.get("/rooms/:userid", async (req, res) => {
  const { userid } = req.params;
  try {
    // Validate if userid is a valid ObjectId before proceeding
    if (!mongoose.Types.ObjectId.isValid(userid)) {
      return res.status(400).json({ err: "Invalid User ID format" });
    }

    const objectId = new mongoose.Types.ObjectId(userid); // Corrected to mongoose.Types.ObjectId
    const rooms = await RoomModel.find({ members: objectId }); // Corrected to .find()

    console.log(rooms);
    return res.status(200).json(rooms); // Sending the rooms back as a response
  } catch (err) {
    console.error("Error fetching rooms:", err); // Log the actual error for debugging
    return res.status(500).json({ err: "Internal Server Error" }); // More specific error
  }
});

server.listen(4000, () => console.log("server is working"));
