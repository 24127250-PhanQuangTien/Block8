# Block 8 — Lựa chọn công nghệ

## Giữ nguyên nền Block 7

| Công nghệ | Lựa chọn và lý do |
|---|---|
| Node.js + Express | Giữ backend hiện có, router và middleware theo cùng phong cách CommonJS; tránh dựng project mới và không làm đổi endpoint CRUD. |
| Prisma + PostgreSQL/Supabase | Giữ ORM/schema hiện tại và dữ liệu Block 7. Auth được thêm bằng migration SQL `IF NOT EXISTS`; không reset schema, không chạy lại seed 1.000 món. |
| React 18 + React Router + Vite | Giữ nguyên SPA. Vite dev server proxy request auth/API tới Express và kiểm tra session trước khi phân phối module/static của SPA; production Express chỉ phân phối `web/dist` sau `requireLogin`. |
| `dotenv` | Đã dùng trong API; giữ lại để cấu hình môi trường và bổ sung `.env.example`, không đưa secret vào mã nguồn. |
| `validator` | Thêm cho `isEmail`, thay vì tự duy trì regex email. |

## Phần xác thực mới

| Công nghệ | Lựa chọn và lý do / đánh đổi |
|---|---|
| `express-session` | Middleware session chuẩn cho Express; hỗ trợ regenerate khi đăng nhập, rolling cookie và middleware hiện có. |
| `connect-pg-simple` + `pg` | Session lưu bền trong PostgreSQL, không dùng MemoryStore. Bảng `session` được migration quản lý (`createTableIfMissing: false`); mặc định dùng `DATABASE_URL`, có thể đặt `SESSION_DATABASE_URL` để dùng `DIRECT_URL` nếu pooler không tương thích. |
| `argon2` | Hash password bằng Argon2id; chi phí tính toán cao hơn hash nhanh và phù hợp lưu password. |
| `svg-captcha` | Sinh CAPTCHA SVG phía server. Đáp án giữ ở server; thử thách được ràng buộc với phiên ẩn danh, mục đích và hạn dùng. |
| `nodemailer` | Gửi email qua SMTP cấu hình từ `.env`; khi chưa có SMTP, dùng Ethereal để thử và chỉ ghi URL xem trước email vào log. |
| `ejs` | Render các biểu mẫu auth trực tiếp từ server, không phải thêm route auth phía SPA. |
| CSRF middleware tự viết | Token synchronizer gắn với session, so sánh constant-time; đồng thời từ chối `Origin` khác `APP_ORIGIN`. Không thêm thư viện khác. |
| Rate limiter PostgreSQL tự viết | Dùng upsert nguyên tử trên `RateLimit` để giữ bộ đếm qua lần khởi động lại và không cần Redis. |
| API client hiện có | Đổi base URL tuyệt đối sang đường dẫn cùng origin và thêm CSRF header/điều hướng đăng nhập mà không thay đổi hợp đồng response Block 7. |

## Ràng buộc tương thích và đánh đổi

- Không bật CORS cho SPA; Vite proxy giữ cookie `SameSite=Lax` cùng origin. Production cần reverse proxy/static host cùng origin.
- Không thêm framework bảo mật/validation mới; security headers được giới hạn vào yêu cầu hiện tại. Reverse proxy vẫn cần TLS khi chạy production.
- Mail Ethereal chỉ dành cho phát triển; môi trường thật phải cấu hình SMTP.
- Các view auth được phục vụ riêng bằng EJS; CRUD và SPA Block 7 không được chuyển sang SSR.
- Không nâng `react-router-dom` đang có của Block 7 vì đây là nâng major ngoài phạm vi auth; frontend dependency audit hiện còn advisories ở dependency cũ và cần một đợt nâng cấp riêng.
