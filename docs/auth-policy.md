# Chính sách xác thực — Block 8

## Khảo sát repo

- Backend: Node.js + Express 4, CommonJS, REST API trong `api/src`.
- ORM/database: Prisma 5 + PostgreSQL/Supabase; schema hiện có giữ nguyên các bảng món ăn, đầu bếp và nguyên liệu.
- Frontend: React 18, React Router 6 và Vite; client API tập trung tại `web/src/apiClient.js`.
- Dev hiện có hai tiến trình: Express mặc định cổng 3000 và Vite cổng 5173; Vite proxy các đường dẫn auth/API về Express, cùng origin ở phía browser.
- Production Express phục vụ `web/dist` sau `requireLogin`; auth pages được server-render bằng EJS.
- API client được đổi sang URL tương đối `/api`; request ghi dữ liệu kèm `X-CSRF-Token`.
- Migration auth riêng, không sửa migration Block 7 và không reset/reseed dữ liệu hiện có.

## Chính sách công bố

| Hạng mục | Chính sách | Lý do |
|---|---|---|
| Email | Trim, lowercase toàn bộ; lưu `emailRaw` và `email` unique | Chuẩn hóa identity và tránh trùng khác hoa/thường. |
| Password | 8–128 ký tự, có ít nhất một chữ cái và chữ số | Giới hạn đồng nhất giữa đăng ký, seed và reset. |
| OTP kích hoạt | 6 chữ số từ `crypto.randomInt`; HMAC-SHA256 với `OTP_PEPPER` + `userId`; hạn 10 phút; tối đa 5 lần sai rồi khóa 15 phút | Hash có khóa ngăn dùng lại digest ngoài ngữ cảnh user; so sánh timing-safe. |
| Gửi lại OTP | Chờ ít nhất 60 giây; tối đa 5 lần/giờ; không reset `attempts` hoặc `lockedUntil` | Hạn chế spam và không làm mới số lần thử bằng resend. |
| CAPTCHA | Hạn 5 phút, dùng một lần, gắn anon session + purpose `register`/`login` | Ngăn replay/chuyển CAPTCHA giữa phiên và mục đích. |
| Login sai | Cửa sổ 15 phút; từ 3 lần sai yêu cầu CAPTCHA; đủ 10 lần sai khóa 5 phút; lock trả 429 trước verify password | Giảm brute-force và giữ trạng thái theo email dù đổi cookie/IP. |
| Rate limit IP/email | Login 30/15 phút/IP; register 10/giờ/IP; forgot 20/giờ/IP và 5/giờ/email; activate 20/15 phút/IP và 5/15 phút/email | Lưu bền vững ở `RateLimit`; giới hạn email activate khớp tối đa 5 lần thử OTP. |
| Reset token | 32 byte random base64url; chỉ lưu SHA-256; hạn 15 phút; dùng một lần; mỗi user chỉ một token có hiệu lực | Token không xuất hiện trong DB dạng rõ và bị thu hồi khi yêu cầu token mới. |
| Session | PostgreSQL `connect-pg-simple`; cookie rolling idle 30 phút; tuyệt đối 8 giờ từ `createdAt` | Session bền vững qua restart; hạn tuyệt đối được kiểm tra server-side. |
| Cookie `sid` | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` khi `NODE_ENV=production`; không `Domain` | Hạn chế truy cập từ JavaScript và gửi cookie cross-site. |
| CSRF | Synchronizer token trong session; mọi method ngoài GET/HEAD/OPTIONS phải có `_csrf` hoặc `X-CSRF-Token`; Origin nếu có phải trùng `APP_ORIGIN` | Bảo vệ cả form EJS và API. |
| Seed auth | `npm run seed:auth`; email/password lấy từ env; tạo/cập nhật user active role viewer, không seed món | Cho phép đăng nhập thử mà không tác động seed Block 7. |
| Secret | `SESSION_SECRET` và `OTP_PEPPER` bắt buộc khi khởi động; cấu hình trong `.env`, không commit | Không dùng secret mặc định. |

## Route

**Công khai:** `GET/POST /register`, `GET/POST /activate`, `POST /activate/resend`, `GET/POST /login`, `GET/POST /forgot`, `GET/POST /reset`, `GET /captcha/new`, `/auth.css`, `/auth.js`.

**Bảo vệ bằng `requireLogin`:** `POST /logout`, `/` và static assets của SPA, toàn bộ `/api/*` bao gồm CRUD/list/search/filter/sort/pagination, `GET /api/me`, `GET /api/csrf`. Session thiếu, idle-expired, absolute-expired hoặc user không active đều bị redirect `303 /login`.

## Sai khác / diễn giải cần biết

- `GET /captcha/new` bắt buộc phát sinh challenge và bộ đếm IP; GET form cũng tạo session/CSRF. Đây là state kỹ thuật cần thiết để đáp ứng hợp đồng cấp CAPTCHA và synchronizer-token. Các GET còn lại không thay đổi trạng thái nghiệp vụ; riêng `GET /reset` chỉ đọc token.
- Bộ đếm `activate:send:<email>` dùng chung cho POST đăng ký hợp lệ và gửi lại, để phản hồi 429/ẩn email không đổi giữa email tồn tại và không tồn tại. Do đó yêu cầu hợp lệ bị giới hạn cũng tiêu thụ ngân sách gửi lại, dù cooldown có thể khiến email không thực sự được gửi; challenge vẫn chặn tối đa 5 lần gửi thực tế.
- Diễn giải vận hành: sau khi khóa 15 phút hết hạn, lần POST kích hoạt tiếp theo mở một chu kỳ thử mới; resend không xóa bộ đếm hoặc thời gian khóa.
- Khi thiếu SMTP, hệ thống tạo tài khoản Ethereal bất đồng bộ; log chỉ chứa URL preview do Ethereal trả về, không in OTP hoặc token thành chuỗi riêng.
- Vite dev server gọi endpoint xác thực của Express để chặn phân phối SPA/module khi chưa đăng nhập. Cần chạy Express ở cổng 3000 và Vite ở 5173; `APP_ORIGIN` phải là origin browser.
