# PROMPT CHO CODING AGENT — Block 8: Xác thực tài khoản (session + cookie) trên nền Block 7

> Bạn là coding agent. Hãy đọc TOÀN BỘ file này, sau đó **thực thi một mạch, không hỏi lại**. Khi có điểm chưa rõ, chọn phương án an toàn nhất, ghi quyết định vào `docs/auth-policy.md`. Chỉ dừng lại hỏi nếu thiếu thứ không thể tự quyết (ví dụ credential SMTP thật).

---

## 0. Bối cảnh

Dự án hiện tại là **Restaurant App của Block 7** (tuần trước): backend REST API (món ăn, đầu bếp, nguyên liệu) + SPA admin chạy trên browser, dữ liệu **1.000+ món** seed trong **Supabase PostgreSQL**, có **phân trang** (số trang / Load More / Infinite Scroll), **filter, sort, search** (cơ bản, nâng cao, fulltext, fuzzy) xử lý phía server.

**Nhiệm vụ Block 8:** thêm hệ thống **xác thực tài khoản bằng session + cookie** theo mô hình server-side. **Không được làm hỏng bất kỳ tính năng nào của Block 7.** Không dựng project mới, không reseed lại 1.000 món.

Phân quyền (RBAC/ABAC), MFA, JWT thuộc Block 9: **không làm**. Role chỉ là cột `role` mặc định `viewer`, chưa dùng để chặn gì.

---

## 1. BƯỚC 0 — Khảo sát trước khi code (bắt buộc)

1. Đọc cấu trúc repo, `package.json`, `.env*`, schema DB (Prisma hoặc lớp dữ liệu hiện có), file server chính, thư mục SPA, cách SPA gọi API (base URL, `fetch`/axios), cách SPA được build/serve.
2. Ghi kết quả khảo sát ngắn (5–10 dòng) ở đầu `docs/auth-policy.md`: backend framework, ORM, FE stack, cách chạy dev, cách SPA gọi API.
3. **Nguyên tắc giữ stack:** nếu project đã dùng công nghệ khác với mục 2 cho cùng vai trò (ví dụ ORM khác Prisma, FE khác), **GIỮ công nghệ hiện có**, chỉ thêm phần mới theo cùng phong cách, và ghi chú sự khác biệt trong `tech-choice.md`. Chỉ thêm thư viện mới cho phần chưa có.
4. Chạy thử app hiện tại một lần để chắc Block 7 đang hoạt động (list + phân trang + search + sort + filter) trước khi sửa.

---

## 2. Technical stack (khóa cho phần mới)

| Vai trò | Lựa chọn |
|---|---|
| Runtime / server | Node.js + Express (giữ nguyên nếu đang dùng) |
| ORM / DB | Prisma + Supabase PostgreSQL (giữ nguyên) |
| Session | `express-session` + `connect-pg-simple` (store trong PostgreSQL, **bền vững**) |
| Hash password | `argon2` (Argon2id) |
| CAPTCHA | `svg-captcha` + bảng thử thách ở server (tự quản lý xác minh) |
| Email | `nodemailer` (SMTP qua `.env`; nếu chưa cấu hình SMTP thì dùng tài khoản test Ethereal, chỉ log **link xem trước email**, không log OTP/token) |
| Giao diện auth | Server-render bằng `ejs` (các trang đăng ký, kích hoạt, đăng nhập, quên/đặt lại mật khẩu, lỗi 429) |
| Validate email | `validator` (`isEmail`), không tự viết regex |
| CSRF | Tự viết middleware synchronizer token (lưu trong session) + kiểm tra `Origin` |
| Rate limit / brute force | Tự viết helper dùng bảng `RateLimit` trong DB (đếm ở server, bền vững) |
| Cấu hình | `dotenv`; mọi secret trong `.env`, có `.env.example`, **không commit `.env`** |
| SPA (FE) | Giữ nguyên FE của Block 7; chỉ thêm wrapper `fetch` xử lý CSRF + redirect đăng nhập + nút Logout |

Thư viện được phép thêm: `express-session`, `connect-pg-simple`, `pg`, `argon2`, `svg-captcha`, `nodemailer`, `ejs`, `validator`, `dotenv`, `cookie-parser` (nếu cần). Không thêm thư viện ngoài danh sách nếu không có lý do, và nếu thêm thì ghi lý do vào `tech-choice.md`.

---

## 3. Chính sách (hằng số cấu hình tập trung trong `config/authPolicy.js`, đọc từ env nếu có)

| Hạng mục | Giá trị |
|---|---|
| Email | `trim()` + chuyển **toàn bộ về chữ thường**; lưu cả `emailRaw` (bản nhập) và `email` (bản chuẩn hóa, **unique**) |
| Password | 8–128 ký tự, phải có chữ và số |
| OTP kích hoạt | 6 chữ số, sinh bằng `crypto.randomInt`, hạn **10 phút**, tối đa **5 lần thử sai**, sau đó khóa **15 phút** |
| Gửi lại OTP | cách nhau tối thiểu **60 giây**, tối đa **5 lần / giờ / tài khoản**; `attempts` **không** reset khi gửi lại |
| CAPTCHA | hạn **5 phút**, dùng **một lần** (kể cả trả lời sai), gắn **phiên ẩn danh** + `purpose` (`register` / `login`) |
| Đăng nhập sai | cửa sổ đếm **15 phút**; từ **3** lần sai (theo email chuẩn hóa) → bắt buộc CAPTCHA; đủ **10** lần sai → khóa **5 phút** (trả 429 dù CAPTCHA/password đúng) |
| Giới hạn theo IP | đăng nhập: **30** lần thử / 15 phút / IP; đăng ký: **10** / giờ / IP; `/forgot`: **20** / giờ / IP và **5** / giờ / email; `/activate`: **20** / 15 phút / IP |
| Reset token | 32 byte ngẫu nhiên (base64url), lưu **SHA-256 hash**, hạn **15 phút**, dùng **một lần**, mỗi user chỉ **một** token còn hiệu lực |
| Session | cookie tên `sid`; hạn **không hoạt động 30 phút** (rolling) và hạn **tuyệt đối 8 giờ** (kiểm tra ở server bằng `createdAt` trong session) |
| Cookie `sid` | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` khi `NODE_ENV=production`; không đặt `Domain` |

Ghi toàn bộ bảng này, kèm lý do ngắn, vào `docs/auth-policy.md` (đây là chính sách “công bố”).

---

## 4. Mô hình dữ liệu cần thêm (migration an toàn, không đụng bảng Block 7)

```
User
  id (PK), emailRaw, email (unique, chuẩn hóa), passwordHash,
  role (default 'viewer'), status ('pending' | 'active', default 'pending'),
  emailVerifiedAt (nullable), createdAt, updatedAt

ActivationChallenge            -- 1 dòng / tài khoản pending
  id, userId (unique, FK User), purpose ('activation'), otpHash,
  expiresAt, attempts (default 0), lockedUntil (nullable),
  lastSentAt, sendCount, sendWindowStart, usedAt (nullable)

PasswordReset
  id, userId (FK User), tokenHash (unique), expiresAt, usedAt (nullable), createdAt

CaptchaChallenge
  id (challengeId, ngẫu nhiên), anonId, purpose ('register'|'login'),
  answer, expiresAt, usedAt (nullable)

RateLimit
  key (PK, ví dụ 'login:email:abc@x.com', 'login:ip:1.2.3.4'),
  count, windowStart, lockedUntil (nullable)

Session                        -- khớp bảng của connect-pg-simple
  sid (varchar, PK), sess (json), expire (timestamp(6)) , @@map("session")
  (index trên expire)
```

Ràng buộc:
- Khai báo model `Session` trong schema ORM khớp bảng `session` của `connect-pg-simple` và đặt `createTableIfMissing: false` để migration quản lý (tránh drift).
- Với Supabase: dùng `DATABASE_URL` (pooler) cho ORM; nếu `pg` Pool của session store lỗi với pooler thì dùng `DIRECT_URL`. Ghi hướng dẫn vào `.env.example`.
- OTP hash: `HMAC-SHA256(OTP_PEPPER, userId + ':' + otp)`; so sánh bằng `crypto.timingSafeEqual`.
- Dọn dẹp định kỳ (cron đơn giản `setInterval` hoặc khi khởi động): xóa session hết hạn, CaptchaChallenge hết hạn, OTP/reset token cũ.
- Script `seed:auth` (không đụng seed 1.000 món): tạo **ít nhất 1 tài khoản `active`**, email/password đọc từ `SEED_USER_EMAIL` / `SEED_USER_PASSWORD` trong `.env`.

---

## 5. Route & hành vi (theo đúng thứ tự xử lý)

### Route công khai (không cần đăng nhập)
`GET/POST /register`, `GET/POST /activate`, `POST /activate/resend`, `GET/POST /login`, `GET/POST /forgot`, `GET/POST /reset`, `GET /captcha/new`, tài nguyên tĩnh của trang auth.

### Route bảo vệ (bắt buộc đăng nhập — middleware `requireLogin`)
`POST /logout`, `GET /` (SPA), toàn bộ file tĩnh của SPA, **toàn bộ `/api/*` (cả GET: list, chi tiết, search, filter, sort, phân trang, và POST/PUT/PATCH/DELETE)**, `GET /api/me`, `GET /api/csrf`.

`requireLogin`: chưa có session hợp lệ → **`303` tới `/login`**. Session phải còn hạn (idle + tuyệt đối) **và** user `status === 'active'`. Gọi trực tiếp bằng công cụ HTTP không cookie cũng bị chặn như vậy. Đặt middleware **ở server**, không dựa vào việc ẩn nút ở giao diện.

### 5.1 `POST /register`
Thứ tự: rate limit IP → verify CAPTCHA (`purpose=register`, đúng phiên ẩn danh, dùng một lần; thiếu/sai → render lại form, giữ email, bỏ password, mã lỗi `CAPTCHA_FAILED`, **chưa** băm password, **chưa** tạo user, **chưa** gửi mail) → validate (sai → status 200, mã `VALIDATION_FAILED`) → chuẩn hóa email → xử lý:
- Email **chưa có**: băm password (Argon2id) → tạo User `pending`, role `viewer` (**bỏ qua mọi `role` trong body**) → sinh OTP → lưu `otpHash` + hạn → gửi mail (bất đồng bộ).
- Email **đã `active`**: không tạo gì thêm, không gửi OTP.
- Email **đang `pending`**: **không ghi đè password**; coi như yêu cầu gửi lại OTP (tôn trọng thời gian chờ).
- **Mọi nhánh hợp lệ** đều trả cùng một kết quả: lưu `activationEmail` vào session ẩn danh, `303` tới `GET /activate`, trang hiển thị thông báo chung *“Nếu email hợp lệ, chúng tôi đã gửi mã kích hoạt.”* Nội dung, status và thời gian phản hồi không phân biệt được các nhánh (gửi mail không chặn response).

### 5.2 `POST /activate`
Rate limit theo IP và theo email. Với email + OTP: kiểm tra giới hạn thử/khóa **trước** khi so hash. Điều kiện thành công đồng thời: user `pending`, `purpose=activation`, chưa hết hạn, `usedAt` rỗng, chưa vượt giới hạn thử, hash khớp. Mọi lý do thất bại (kể cả email không tồn tại) → cùng một thông báo `INVALID_OTP` (status 200), tăng `attempts` nếu có challenge. Thành công → trong **một thao tác nguyên tử/transaction**: `usedAt=now`, user → `active`, `emailVerifiedAt=now`; đảm bảo **hai request đồng thời chỉ một request thắng**. **Không tự đăng nhập**; `303` tới `/login` kèm thông báo “đã kích hoạt, hãy đăng nhập”. Vượt giới hạn → trang `429` (mã `RATE_LIMITED`).

### 5.3 `POST /activate/resend`
Cùng phản hồi dù email có hay không có tài khoản pending. Có thời gian chờ 60 giây và giới hạn 5 lần/giờ (quá giới hạn → `429`). Sinh OTP mới **ghi đè** `otpHash`/`expiresAt` (mã cũ hết hiệu lực), cập nhật `lastSentAt`, **không reset `attempts` và `lockedUntil`**.

### 5.4 `POST /login`
Thứ tự **bắt buộc**:
1. **Rate limit / khóa tạm** (theo email chuẩn hóa và theo IP) → nếu đang khóa: trang `429`, kể cả CAPTCHA/password đúng.
2. Nếu số lần sai của email ≥ 3 trong cửa sổ: **xác minh CAPTCHA** (`purpose=login`); thiếu/sai → render lại form kèm CAPTCHA mới, giữ email, bỏ password, **không** kiểm tra password. Backend tự quyết định có cần CAPTCHA; việc xóa trường CAPTCHA trong HTML hay gọi `POST /login` trực tiếp **không** được bỏ qua bước này.
3. Kiểm tra password bằng `argon2.verify`. **Email không tồn tại và password sai dùng cùng một thông báo chung** (và cùng chi phí thời gian: nếu không có user, vẫn chạy một lần verify với hash giả).
4. Password sai → tăng bộ đếm theo email **và** IP (kể cả email không tồn tại); giải đúng CAPTCHA **không** reset bộ đếm.
5. Password đúng nhưng user `pending` → **không tạo session**, hiện thông báo cần kích hoạt kèm link `/activate`.
6. Password đúng và `active` → `req.session.regenerate()` (**đổi `sid`** để chống session fixation) → lưu `userId`, `createdAt` vào session → xóa bộ đếm sai theo email (**không** xóa giới hạn IP) → `303` tới trang chính. Response có `Set-Cookie: sid=...`.

OTP kích hoạt và reset token **không** được chấp nhận làm password ở `/login`.

### 5.5 `POST /logout`
Chỉ POST (kiểm tra CSRF). Hủy session ở server (`req.session.destroy`) **trước**, rồi `clearCookie('sid')` với đúng các thuộc tính, `303` tới `/login`. Dùng lại `sid` cũ → bị từ chối.

### 5.6 `POST /forgot`
Rate limit theo email và IP. Luôn trả cùng nội dung/status *“Nếu email đã đăng ký, hướng dẫn đã được gửi.”* cho email có và không có (gửi mail bất đồng bộ để thời gian tương đương). Nếu user tồn tại: vô hiệu hóa các reset token chưa dùng của user, tạo token mới, lưu hash + hạn, gửi link `APP_BASE_URL/reset?token=...` (**lấy từ cấu hình server, không dùng header `Host`**).

### 5.7 `GET /reset?token=...` và `POST /reset`
- `GET`: chỉ **kiểm tra** (hash token, còn hạn, chưa dùng) rồi hiện form; **không đổi bất kỳ dữ liệu nào**. Token sai/hết hạn/đã dùng → cùng một thông báo “link không dùng được”. Trang đặt header `Referrer-Policy: no-referrer`.
- `POST`: token (hidden field) + password mới (đúng policy). Kiểm tra và đánh dấu `usedAt` là **một thao tác nguyên tử**. Sau đó: cập nhật `passwordHash`, vô hiệu các reset token còn lại của user, **xóa mọi session của user** (`DELETE FROM session WHERE sess->>'userId' = $1`), gửi email báo mật khẩu đã đổi (không chứa mật khẩu), `303` tới `/login`. **Không tự đăng nhập.** Reset **không** kích hoạt tài khoản pending. Reset token **không** dùng được ở route nào khác.

### 5.8 CAPTCHA
- `GET /captcha/new?purpose=...` trả JSON `{ challengeId, svg }`; trang SSR cũng nhúng sẵn SVG + hidden `challengeId` khi cần.
- **Không bao giờ** trả đáp án (`text`) cho client, không đặt trong hidden field, cookie đọc được, JSON, alt text.
- Xác minh: tiêu thụ thử thách trong một thao tác nguyên tử (`UPDATE ... WHERE usedAt IS NULL AND expiresAt > now AND purpose = ? AND anonId = ? RETURNING answer`), so đáp án không phân biệt hoa/thường. Giới hạn tần suất cho endpoint cấp CAPTCHA (theo IP). Có nút “đổi mã” (làm mới hủy thử thách cũ). Có `aria-label`/phương án thay thế khả dụng tối thiểu (ví dụ link “gửi lại mã”).

### 5.9 CSRF
- Token ngẫu nhiên lưu trong session (kể cả phiên ẩn danh); **mọi request không phải GET/HEAD/OPTIONS** (cả form auth lẫn `/api/*`) phải có token đúng (hidden field `_csrf` hoặc header `X-CSRF-Token`), so sánh bằng `timingSafeEqual`. Thêm kiểm tra `Origin` (nếu có) phải trùng `APP_ORIGIN`.
- **Mọi `GET` tuyệt đối không đổi dữ liệu.**

### 5.10 Cấu hình bảo mật chung
- `app.disable('x-powered-by')`; cấu hình `trust proxy` qua env khi chạy sau proxy; secret (`SESSION_SECRET`, `OTP_PEPPER`) bắt buộc có trong `.env` (khởi động báo lỗi rõ nếu thiếu).
- Không log password, `passwordHash`, OTP, reset token, đáp án CAPTCHA, giá trị `sid`.
- Mọi thông báo lỗi đăng nhập/kích hoạt/reset dùng thông báo chung đã nêu; mã lỗi nội bộ (`VALIDATION_FAILED`, `INVALID_OTP`, `RATE_LIMITED`, `CAPTCHA_FAILED`) đặt trong thuộc tính `data-error-code` của phần tử lỗi để dễ kiểm chứng.

---

## 6. Tích hợp với SPA của Block 7

1. **Cùng origin:** SPA và API phải cùng origin với server auth để cookie `sid` `SameSite=Lax` hoạt động. Nếu SPA chạy dev server riêng (ví dụ Vite), cấu hình **proxy** `/api`, `/login`, … sang Express thay vì mở CORS.
2. Chỉ phục vụ file SPA sau `requireLogin` (chưa đăng nhập vào `/` → `303 /login`).
3. Thêm một module nhỏ `apiFetch` trong SPA, thay mọi lời gọi `fetch`/axios hiện có:
   - Lấy CSRF token từ `GET /api/csrf` một lần, gắn header `X-CSRF-Token` cho request không phải GET.
   - Nếu `response.redirected` và đường dẫn đích là `/login` → `window.location.assign('/login')`.
4. Thêm hiển thị email đang đăng nhập (`GET /api/me`) và nút **Logout** (gọi `POST /logout` rồi chuyển tới `/login`).
5. **Hồi quy Block 7:** sau khi tích hợp, các tính năng sau vẫn chạy y như trước khi đăng nhập: phân trang số trang, Load More, Infinite Scroll, filter, sort, search cơ bản/nâng cao/fulltext/fuzzy, CRUD món/đầu bếp/nguyên liệu. Ghi kết quả hồi quy vào `docs/VERIFY.md`.

---

## 7. Sản phẩm bàn giao (tạo/cập nhật đúng các file sau)

| File | Nội dung |
|---|---|
| Mã nguồn | Theo cấu trúc hiện có của repo; tách module rõ ràng (`routes/auth`, `middleware/requireLogin`, `middleware/csrf`, `services/{mail,otp,captcha,rateLimit,session}`, `views/auth/*`) |
| `.env.example` | Đủ biến: `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `OTP_PEPPER`, `APP_BASE_URL`, `APP_ORIGIN`, `SMTP_HOST/PORT/USER/PASS/FROM`, `SEED_USER_EMAIL`, `SEED_USER_PASSWORD`, `NODE_ENV` (kèm chú thích) |
| `tech-choice.md` | Lý do chọn **từng** công nghệ trong mục 2 (giữ nguyên hay thêm mới, thay thế nào, đánh đổi), bằng tiếng Việt |
| `docs/auth-policy.md` | Kết quả khảo sát (Bước 0) + bảng chính sách mục 3 + danh sách route công khai/bảo vệ |
| `docs/flows.md` | Bản **nháp** sơ đồ Mermaid: đăng ký có CAPTCHA, kích hoạt OTP, đăng nhập có chống brute force, đăng xuất, quên mật khẩu (tôi sẽ tự vẽ lại và giải thích) |
| `docs/VERIFY.md` | Kịch bản kiểm chứng cho **từng dòng** ở mục 8: lệnh `curl` (dùng cookie jar `-c/-b`), kết quả mong đợi, và chỗ cần chụp **Network/Application (Cookies)**/bản ghi DB; nêu rõ chỗ nào phải **che** (`Set-Cookie`, OTP, token) |
| Script | `npm run seed:auth`, `npm run dev`, và lệnh migration |

---

## 8. Kịch bản nghiệm thu mà mã phải thỏa (agent tự tự kiểm tra trước khi kết thúc)

**Đăng ký / kích hoạt:** pending đăng nhập đúng password → không có session · OTP đúng kích hoạt đúng user + có `emailVerifiedAt` · OTP sai/hết hạn/đã dùng → cùng thông báo, trạng thái không đổi · gửi lại OTP → mã cũ bị từ chối, mã mới dùng được · vượt giới hạn thử/gửi → `429` ở server, gửi lại **không** reset số lần thử · body có `role: admin` → vẫn `viewer` · kích hoạt xong không có session · dùng OTP làm password ở `/login` → bị từ chối · hai request kích hoạt đồng thời → chỉ một thắng.

**CAPTCHA / brute force:** đăng ký thiếu/sai CAPTCHA → không tạo user, không gửi OTP · CAPTCHA dùng lại/quá hạn/khác phiên/sai `purpose` → bị từ chối · đăng nhập sai đến ngưỡng rồi bỏ trường CAPTCHA → bị chặn trước bước kiểm tra password · giải đúng CAPTCHA nhưng sai password → bộ đếm vẫn tăng · đủ 10 lần sai, gửi password + CAPTCHA đúng → `429`, không có session · xóa cookie / mở phiên ẩn danh mới → **không** reset bộ đếm theo email.

**Đăng nhập / đăng xuất / CRUD:** chưa đăng nhập gọi **mọi** route CRUD/API (GET/POST/PATCH/DELETE) → `303 /login`, dữ liệu không đổi · đăng nhập đúng + `active` → `303` + `Set-Cookie: sid` + vào được CRUD · sai email hoặc sai password → cùng một thông báo · `sid` trước/sau đăng nhập **khác nhau** · khởi động lại server thật (dừng tiến trình, chạy lại) rồi dùng lại cookie → vẫn đăng nhập · logout rồi dùng `sid` cũ → bị từ chối, bản ghi session đã xóa · gửi form đổi dữ liệu từ trang/origin khác hoặc thiếu CSRF → bị từ chối · cờ cookie: `HttpOnly`, `SameSite=Lax`, `Secure` ở production.

**Quên mật khẩu:** email có/không có → cùng nội dung + status · vượt giới hạn `/forgot` → `429` · token cũ/hết hạn/đã dùng → bị từ chối, password không đổi · `GET /reset` token hợp lệ → chỉ hiện form, `usedAt` vẫn rỗng · reset thành công → không tự đăng nhập, `sid` cũ bị từ chối · dùng reset token ở route khác → bị từ chối.

**Hồi quy Block 7:** mọi tính năng ở mục 6.5 vẫn hoạt động sau khi đăng nhập.

---

## 9. Quy tắc làm việc

- Làm theo thứ tự: khảo sát → schema/migration → services → route + view auth → `requireLogin` + CSRF → tích hợp SPA → seed → tài liệu → tự kiểm tra.
- Không tắt, không mock, không “tạm bỏ qua” bất kỳ kiểm tra bảo mật nào để chạy cho nhanh; không để secret trong mã.
- Không dùng MD5/SHA-256 trực tiếp cho password; không lưu session trong bộ nhớ tiến trình; không có route `GET` nào đổi dữ liệu (kể cả `GET /reset`).
- Không tạo lỗi cố ý và không tự ý “đơn giản hóa” hợp đồng ở trên; nếu buộc phải lệch, ghi rõ trong `docs/auth-policy.md` mục “Sai khác so với đề”.

## 10. Báo cáo cuối cùng (in ra khi xong)

1. Danh sách file đã tạo/sửa (một dòng mô tả mỗi file).
2. Cách chạy: cài đặt, migration, `seed:auth`, `dev`, test.
3. Kết quả tự kiểm tra từng nhóm ở mục 8 (đạt / không đạt / chưa kiểm tra được và vì sao).
4. **5 điểm rủi ro bảo mật tôi nên tự đọc kỹ trong diff** (nêu file và đoạn mã cụ thể: nơi đọc cookie, nơi tra session, nơi chặn request chưa đăng nhập, nơi lưu session/bộ đếm, nơi xử lý đáp án CAPTCHA).
5. Mọi giả định đã tự quyết và mọi chỗ lệch khỏi đề.
