# Sơ đồ luồng auth (bản nháp)

```mermaid
sequenceDiagram
  autonumber
  actor U as Người dùng
  participant B as Browser / EJS
  participant E as Express
  participant DB as PostgreSQL
  participant M as SMTP / Ethereal

  U->>B: GET /register
  B->>E: GET /captcha/new?purpose=register
  E->>DB: Ghi challenge gắn anonId + purpose + TTL
  E-->>B: challengeId + SVG (không có đáp án)
  U->>E: POST /register + CSRF + CAPTCHA
  E->>DB: Rate limit IP, consume CAPTCHA atomically
  E->>DB: Tạo User pending + OTP HMAC
  E-->>U: 303 /activate, thông báo chung
  E-)M: Gửi OTP bất đồng bộ

  U->>E: POST /activate + OTP + CSRF
  E->>DB: Kiểm tra khóa/thử sai, so HMAC timing-safe
  E->>DB: Transaction consume challenge + active user
  E-->>U: 303 /login (không tạo session đăng nhập)

  U->>E: POST /login + password + CSRF
  E->>DB: Rate limit IP/email, yêu cầu CAPTCHA từ lần sai thứ 3
  E->>E: Argon2id verify (dummy hash nếu email không tồn tại)
  E->>DB: Regenerate sid, lưu userId + createdAt
  E-->>U: 303 / + Set-Cookie sid

  U->>E: POST /logout + CSRF
  E->>DB: Destroy session
  E-->>U: Clear sid + 303 /login

  U->>E: POST /forgot + CSRF
  E->>DB: Rate limit; invalidate old reset; store token hash
  E-)M: Gửi reset link bất đồng bộ
  U->>E: GET /reset?token (read-only)
  E-->>U: Form reset + Referrer-Policy: no-referrer
  U->>E: POST /reset + token + password + CSRF
  E->>DB: Atomic consume token, update password, delete user sessions
  E-)M: Email thông báo đổi mật khẩu
  E-->>U: 303 /login (không tự đăng nhập)
```
