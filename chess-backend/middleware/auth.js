const jwt = require('jsonwebtoken');

// Middleware xác thực token
const verifyToken = (req, res, next) => {
  // Lấy token từ header
  const token = req.header('Authorization');

  if (!token) {
    return res.status(401).json({ error: '⛔ Truy cập bị từ chối. Token không tồn tại.' });
  }

  try {
    // Giải mã token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Lưu thông tin người dùng vào request để dùng ở các route sau
    req.user = decoded;

    // Cho phép tiếp tục
    next();
  } catch (err) {
    res.status(400).json({ error: '❌ Token không hợp lệ hoặc đã hết hạn.' });
  }
};

module.exports = verifyToken;
