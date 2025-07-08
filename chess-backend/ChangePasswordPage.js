// ChangePasswordPage.js
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './ChangePasswordPage.module.css';
import { FaKey, FaSpinner, FaCheckCircle } from 'react-icons/fa';

const ChangePasswordPage = () => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const [theme, setTheme] = useState(localStorage.getItem('appTheme') || 'light');
  const [lang, setLang] = useState(localStorage.getItem('appLang') || 'vi');

  const navigate = useNavigate();

  useEffect(() => {
    const handleSettingsChange = () => {
      setTheme(localStorage.getItem('appTheme') || 'light');
      setLang(localStorage.getItem('appLang') || 'vi');
    };
    window.addEventListener('globalSettingsChanged', handleSettingsChange);
    return () => window.removeEventListener('globalSettingsChanged', handleSettingsChange);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(lang === 'vi' ? 'Vui lòng điền tất cả các trường.' : 'Please fill in all fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(lang === 'vi' ? 'Mật khẩu mới không khớp.' : 'New passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setError(lang === 'vi' ? 'Mật khẩu mới phải có ít nhất 6 ký tự.' : 'New password must be at least 6 characters long.');
      return;
    }
     if (newPassword === currentPassword) {
      setError(lang === 'vi' ? 'Mật khẩu mới phải khác mật khẩu hiện tại.' : 'New password must be different from the current password.');
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found. Please log in again.');
      }
      
      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';
      const response = await fetch(`${apiUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'An error occurred.');
      }

      setSuccess(data.message || (lang === 'vi' ? 'Đổi mật khẩu thành công! Bạn sẽ được đăng xuất sau giây lát.' : 'Password changed successfully! You will be logged out shortly.'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      
      setTimeout(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('userId');
        localStorage.removeItem('username');
        navigate('/login');
      }, 3000);

    } catch (err) {
      setError(err.message || (lang === 'vi' ? 'Đã xảy ra lỗi. Vui lòng thử lại.' : 'An error occurred. Please try again.'));
    } finally {
      setLoading(false);
    }
  };
  
  const containerClassName = theme === 'dark' ? `${styles.container} ${styles.containerDark}` : styles.container;
  const formClassName = theme === 'dark' ? `${styles.formCard} ${styles.formCardDark}` : styles.formCard;

  return (
    <div className={containerClassName}>
      <form onSubmit={handleSubmit} className={formClassName}>
        <h2 className={styles.title}>
          <FaKey />
          {lang === 'vi' ? 'Đổi Mật Khẩu' : 'Change Password'}
        </h2>
        
        {error && <p className={styles.errorMessage}>{error}</p>}
        {success && <p className={styles.successMessage}><FaCheckCircle /> {success}</p>}
        
        <div className={styles.inputGroup}>
          <label htmlFor="currentPassword">{lang === 'vi' ? 'Mật khẩu hiện tại' : 'Current Password'}</label>
          <input
            type="password"
            id="currentPassword"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={loading}
            required
          />
        </div>
        
        <div className={styles.inputGroup}>
          <label htmlFor="newPassword">{lang === 'vi' ? 'Mật khẩu mới' : 'New Password'}</label>
          <input
            type="password"
            id="newPassword"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={loading}
            required
          />
        </div>
        
        <div className={styles.inputGroup}>
          <label htmlFor="confirmPassword">{lang === 'vi' ? 'Xác nhận mật khẩu mới' : 'Confirm New Password'}</label>
          <input
            type="password"
            id="confirmPassword"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
            required
          />
        </div>

        <button type="submit" className={styles.submitButton} disabled={loading || !!success}>
          {loading ? (
            <FaSpinner className={styles.spinner} />
          ) : (
            lang === 'vi' ? 'Xác nhận thay đổi' : 'Confirm Change'
          )}
        </button>
      </form>
    </div>
  );
};

export default ChangePasswordPage;