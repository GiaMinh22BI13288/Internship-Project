const express = require('express');
const router = express.Router();
const Room = require('../models/Room');
const verifyToken = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Tạo phòng mới
router.post('/create', verifyToken, async (req, res) => {
  try {
    const roomId = uuidv4().slice(0, 6).toUpperCase(); // ví dụ: "A1B2C3"
    const room = new Room({
      roomId,
      players: [req.user.id] // người tạo là người chơi đầu tiên
    });

    await room.save();
    res.json({ message: 'Tạo phòng thành công!', roomId });
  } catch (err) {
    res.status(500).json({ error: 'Không thể tạo phòng.' });
  }
});

// Tham gia phòng
router.post('/join', async (req, res) => {
  const { roomId } = req.body;
  try {
    const room = await Room.findOne({ roomId });

    if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    if (room.players.length >= 2) return res.status(400).json({ error: 'Phòng đã đầy.' });

    // Thêm người chơi vào phòng (tạm hard-code user ID để test)
    room.players.push("test-user"); // ⚠️ thay thế req.user.id
    room.status = 'playing';
    await room.save();

    res.json({ message: 'Đã tham gia phòng!', roomId });
  } catch (err) {
    res.status(500).json({ error: 'Không thể tham gia phòng.' });
  }
});
module.exports = router;
