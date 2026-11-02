# Block 8 — Kịch bản kiểm chứng

## Chuẩn bị môi trường

```powershell
Copy-Item .env.example .env
# Điền DATABASE_URL, SESSION_SECRET, OTP_PEPPER và cấu hình Supabase.
npm --prefix api install
npm --prefix web install
npm --prefix api run db:generate
npm run migrate:auth
npm run seed:auth
npm run dev:api
# Terminal thứ hai
npm run dev:web
```

Dev browser truy cập `http://localhost:5173`; Vite proxy auth/API về Express `localhost:3000`. Cần cấu hình SMTP để nhận email thật; nếu không, theo dõi URL Ethereal preview trên log server. Không ghi lại hoặc chia sẻ URL preview. Trong các lệnh bên dưới dùng cookie jar để giữ cùng session:

```sh
BASE=http://localhost:5173
JAR=auth-cookies.txt
curl -sS -c "$JAR" -b "$JAR" "$BASE/register" -o register.html
CSRF=$(sed -n 's/.*name="_csrf" value="\([^"]*\)".*/\1/p' register.html | head -n 1)
```

CAPTCHA được nhúng dưới dạng SVG nhưng không có đáp án trong HTML/JSON/cookie. Nhập mã bằng browser khi cần kiểm thử thủ công. Các POST dùng `-b "$JAR" -c "$JAR"` và `_csrf=$CSRF`; mỗi trang render lại có thể cấp token/challenge mới. Thay email và password thử nghiệm bằng dữ liệu dùng riêng cho môi trường test.

## Đăng ký và kích hoạt

1. **Pending không đăng nhập:** mở `/register`, gửi POST hợp lệ với CAPTCHA và kiểm tra `HTTP 303 Location: /activate`. Trước khi kích hoạt, `curl -i -b "$JAR" "$BASE/api/me"` phải là `303 /login`; DB: `"User".status='pending'`, `role='viewer'`.
2. **Không nhận role từ body:** gửi cùng form thêm `role=admin`; kiểm tra DB vẫn `viewer`.
3. **CAPTCHA thiếu/sai/replay/hết hạn/sai purpose/khác anon session:** POST form với `captchaChallengeId` thiếu hoặc challenge đã tiêu thụ; kỳ vọng form render `200`, `data-error-code="CAPTCHA_FAILED"`, giữ email và không có password input value. DB không tăng User/ActivationChallenge và không phát sinh email OTP. Gửi POST cùng challenge lần hai phải tiếp tục bị từ chối.
4. **Validate:** CAPTCHA hợp lệ nhưng email/password không hợp lệ → `200`, `data-error-code="VALIDATION_FAILED"`; không tạo User.
5. **Kích hoạt OTP:** nhập OTP trong email Ethereal/SMTP. Mã đúng → `303 /login?activated=1`, User active và `emailVerifiedAt` khác NULL; `/api/me` vẫn redirect login, chứng minh không auto-login.
6. **OTP sai/hết hạn/đã dùng/không tồn tại:** lặp POST với từng trường hợp; thông báo/status như nhau (`200`, `INVALID_OTP`), user không đổi. Request đồng thời bằng cùng OTP: chỉ một transaction thắng.
7. **Resend:** POST `/activate/resend` liên tiếp dưới 60 giây không gửi thêm; sau thời gian chờ, OTP cũ bị từ chối và mã mới hợp lệ. Sau 5 lần gửi/giờ hoặc 5 lần OTP sai đang khóa, server trả `429`; resend không reset `attempts`/`lockedUntil`.
8. **OTP không phải password:** gửi OTP vào `/login`; phải nhận thông báo chung sai email/password, không tạo session.

Ví dụ gửi form (CAPTCHA ID và nội dung do người kiểm tra lấy từ trang, không lưu đáp án vào file):

```sh
curl -i -b "$JAR" -c "$JAR" -H "Origin: $BASE" \
  --data-urlencode "_csrf=$CSRF" \
  --data-urlencode "email=auth-test@example.test" \
  --data-urlencode "password=TestPass123" \
  --data-urlencode "captchaChallengeId=$CHALLENGE_ID" \
  --data-urlencode "captchaAnswer=$CAPTCHA_ANSWER" \
  "$BASE/register"
```

## CAPTCHA và chống brute-force

1. Tạo ba lần đăng nhập sai cho cùng email chuẩn hóa, dùng cookie jar hoặc phiên ẩn danh khác nhau. Lần kế tiếp bỏ CAPTCHA: server phải render CAPTCHA mới trước khi kiểm tra password; password trống/sai không làm tăng password-failure counter khi CAPTCHA thiếu/sai.
2. CAPTCHA đúng + password sai vẫn tăng bộ đếm email; đổi/xóa cookie không xóa bộ đếm.
3. Sau 10 lần sai trong 15 phút, gửi password và CAPTCHA đúng; kỳ vọng `429` và không có session. Chờ khóa 5 phút, xác nhận policy mở lại CAPTCHA.
4. Xóa cookie jar rồi lặp lại; bộ đếm email vẫn còn. Tạo CAPTCHA hết hạn (đợi 5 phút) hoặc dùng sai purpose/session; các trường hợp đều thất bại.
5. Gửi yêu cầu CAPTCHA vượt ngưỡng IP; endpoint trả `429`. Thử thay đổi/đọc HTML, SVG và JSON: không có field `text`, đáp án, hay answer trong alt text.

## Session, API và CRUD

1. Không cookie: gọi từng route `/api/dishes`, `/api/dishes/:id`, `/api/chefs`, `/api/ingredients`, cùng POST/PATCH/DELETE; mọi request phải trả `303 /login`, không thay đổi DB. SPA root/static khi truy cập trực tiếp cũng chuyển `/login`.
2. Đăng nhập bằng seed user active: POST `/login` trả `303 /` và `Set-Cookie: sid=...; Path=/; HttpOnly; SameSite=Lax`. Ghi nhận giá trị sid cũ (che trong ảnh/chia sẻ); sau đăng nhập sid phải khác. Cookie production phải có `Secure`, không được có `Domain`.
3. Sau login, kiểm tra `GET /api/me` trả email đúng; `GET /api/csrf` trả token. Không có token hoặc Origin khác `APP_ORIGIN` khi POST/PATCH/DELETE phải bị từ chối. Với valid CSRF, thực hiện CRUD món/đầu bếp/nguyên liệu.
4. Dùng cookie jar đăng nhập rồi dừng/restart API; `/api/me` phải còn hoạt động. POST `/logout` với token CSRF trả `303 /login`; DB không còn sid. Dùng lại jar/sid cũ gọi API phải nhận `303 /login`.
5. Chờ idle 30 phút hoặc quá 8 giờ từ login rồi gửi API; server phải yêu cầu login. Cookie idle được rolling khi session còn hoạt động.

```sh
curl -i -b "$JAR" -c "$JAR" "$BASE/api/me"
curl -i -b "$JAR" -c "$JAR" -X POST -H "Origin: $BASE" \
  -H "X-CSRF-Token: $CSRF" "$BASE/logout"
```

## Quên và đặt lại mật khẩu

1. POST `/forgot` với email tồn tại và không tồn tại; nội dung/status đều giống nhau (`200`, “Nếu email đã đăng ký, hướng dẫn đã được gửi.”). Vượt 20 lần/IP/giờ hoặc 5 lần/email/giờ trả `429`.
2. Gửi forgot hai lần cho user: token trước bị vô hiệu hóa. Reset token chỉ có hash trong DB; URL tạo từ `APP_BASE_URL`, không từ Host header.
3. `GET /reset?token=<valid>` chỉ hiển thị form; DB `usedAt` vẫn NULL. Response có `Referrer-Policy: no-referrer`. Token sai/hết hạn/đã dùng cho cùng thông báo và không đổi password.
4. POST token sai, expired, used hoặc password không hợp lệ; không thay đổi password. POST token hợp lệ + password đúng policy: redirect `303 /login`, user vẫn giữ status hiện tại (pending không được activate), mọi session user bị xóa, email thông báo không chứa password, không auto-login. Sid cũ bị từ chối.
5. Thử dùng token reset tại `/login`, `/activate` và các route khác; không route nào chấp nhận nó như password/OTP.

## Hồi quy Block 7

Sau khi đăng nhập, dùng browser và xác nhận từng mục sau:

- Trang list: phân trang số trang, Load More, Infinite Scroll; không trùng/mất món khi chuyển view.
- Filter danh mục/trạng thái, sort, search cơ bản và nâng cao; fulltext và fuzzy được xử lý server-side.
- CRUD món ăn, đầu bếp và nguyên liệu; validation, dropdown/chef selection, chi tiết và xóa vẫn hoạt động.
- Browser Network: API request cùng origin `/api/...`; GET không có CSRF header, POST/PATCH/DELETE có `X-CSRF-Token`; cookie sid được gửi tự động.
- Refresh/deep link các SPA route khi đã login hoạt động; cùng URL khi chưa login chuyển `/login`.

Chạy kiểm thử tự động:

```powershell
npm run test:api
npm run test:auth
npm --prefix api run test:search
npm run verify:block7
npm --prefix web test
npm run build:web
```

`test:search` and `verify:block7` log in through an authenticated Supertest agent and require the seeded 1,000+ dish database plus the active seed user. Browser scripts use same-origin API fixtures but still require a live Vite/API pair and seed login:

```powershell
$env:SEED_USER_EMAIL="..."
$env:SEED_USER_PASSWORD="..."
npm --prefix web run test:browser
npm --prefix web run test:dropdowns
npm --prefix web run test:presentation
```

The API integration tests are skipped when no `DATABASE_URL` is configured. The auth policy/crypto and SPA unit tests do not require a live database.

## Chụp bằng chứng và che dữ liệu

- **Network:** ghi lại method/status/Location/response shape. Che toàn bộ `Set-Cookie`/sid, CSRF token, OTP, reset token, preview URL và email cá nhân.
- **Application → Cookies:** chỉ chụp tên cookie và cờ `HttpOnly`, `SameSite`, `Secure`, `Path`; che giá trị cookie/domain nhạy cảm.
- **Database:** dùng SQL editor để xác nhận `User.status/role/emailVerifiedAt`, challenge attempts/usedAt, token hash/usedAt, `RateLimit` và `session` rows; không chụp `passwordHash`, OTP hash, reset token raw hay đáp án CAPTCHA.
- Ghi thời gian chạy và kết quả của từng nhóm; không đưa secrets hoặc token vào `docs/VERIFY.md`.

## Kết quả chạy trong phiên triển khai

- API/auth unit suite: **5 passed, 1 skipped** (integration requires `.env`/`DATABASE_URL` and an applied migration).
- SPA unit suite: **11 passed**; production Vite build: **passed**; Prisma client generation and EJS template rendering: **passed**.
- Vite auth-gate stub check: **passed** (anonymous redirect, authenticated SPA, backend failure surfaced as 502).
- Backend production dependency audit: **0 vulnerabilities**.
- Hồi quy dữ liệu Supabase, SMTP/Ethereal thực tế, session restart, CRUD đã đăng nhập: **chưa kiểm chứng được** khi thiếu credential kết nối.
