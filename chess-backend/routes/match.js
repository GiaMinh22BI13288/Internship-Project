const express = require('express');
const router = express.Router();
const Match = require('../models/Match');
const verifyToken = require('../middleware/verifyToken');
const User = require('../models/User');

router.post('/record', async (req, res) => {
  try {
    const { white, black, result, playedAt } = req.body;

    const match = new Match({
      white,
      black,
      result,
      playedAt
    });

    await match.save();
    res.json({ message: '✅ Đã ghi nhận kết quả!' });
  } catch (error) {
    console.error('❌ Lỗi ghi lịch sử:', error);
    res.status(500).json({ message: '❌ Không thể lưu kết quả' });
  }
});


router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const matches = await Match.find({
      $or: [{ white: userId }, { black: userId }]
    })
      .sort({ playedAt: -1 })
      .populate('white', 'username avatar')
      .populate('black', 'username avatar');

    res.json(matches);
  } catch (err) {
    res.status(500).json({ message: '❌ Lỗi lấy lịch sử' });
  }
});


// Lấy bảng xếp hạng
router.get('/leaderboard', async (req, res) => {
  try {
    const matches = await Match.find().populate('white').populate('black');

    const stats = {};

    matches.forEach(match => {
      const whiteId = match.white._id.toString();
      const blackId = match.black._id.toString();

      // Khởi tạo nếu chưa có
      if (!stats[whiteId]) {
        stats[whiteId] = { user: match.white, win: 0, lose: 0, draw: 0, total: 0 };
      }
      if (!stats[blackId]) {
        stats[blackId] = { user: match.black, win: 0, lose: 0, draw: 0, total: 0 };
      }

      // Cập nhật theo kết quả
      if (match.result === '1-0') {
        stats[whiteId].win++;
        stats[blackId].lose++;
      } else if (match.result === '0-1') {
        stats[blackId].win++;
        stats[whiteId].lose++;
      } else if (match.result === '1/2-1/2') {
        stats[whiteId].draw++;
        stats[blackId].draw++;
      }

      stats[whiteId].total++;
      stats[blackId].total++;
    });

    const leaderboard = Object.values(stats).sort((a, b) => b.win - a.win);

    res.json(leaderboard);
  } catch (err) {
    console.error('❌ Lỗi leaderboard:', err);
    res.status(500).json({ message: 'Lỗi lấy bảng xếp hạng' });
  }
});


module.exports = router;