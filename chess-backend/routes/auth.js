const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ==================== ĐĂNG KÝ ====================
router.post('/register', async (req, res) => {
  try {
    const { username, password, avatar } = req.body;

    let existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Tên người dùng đã tồn tại' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      password: hashedPassword,
      avatar: avatar || ''
    });

    await newUser.save();

    const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: '✅ Đăng ký thành công!',
      token,
      user: { id: newUser._id, username: newUser.username, avatar: newUser.avatar }
    });
  } catch (error) {
    console.error('❌ Lỗi đăng ký:', error);
    res.status(500).json({ message: '❌ Đăng ký thất bại!' });
  }
});

// ==================== ĐĂNG NHẬP ====================
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: 'Tên người dùng không tồn tại' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Mật khẩu không chính xác' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: '✅ Đăng nhập thành công!',
      token,
      user: { id: user._id, username: user.username, avatar: user.avatar }
    });
  } catch (error) {
    console.error('❌ Lỗi đăng nhập:', error);
    res.status(500).json({ message: '❌ Đăng nhập thất bại!' });
  }
});

// Lấy nhiều user theo mảng ID
router.get('/users', async (req, res) => {
  const ids = req.query.ids?.split(',');
  try {
    const users = await User.find({ _id: { $in: ids } }).select('username avatar');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: '❌ Lỗi khi lấy danh sách người dùng' });
  }
});

module.exports = router;
