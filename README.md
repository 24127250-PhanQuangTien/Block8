# Restaurant App — Block 7 + Block 8

Ứng dụng thực đơn và quản lý nhà hàng gồm React SPA và REST API Express dùng Prisma/PostgreSQL. Khách có thể xem, tìm món theo tên/mô tả và lọc phân loại; phần quản trị quản lý món ăn, đầu bếp và nguyên liệu, lọc trạng thái phục vụ và sắp xếp giá. Form món ăn hỗ trợ tìm đầu bếp theo tên/chuyên môn với tiếng Việt có/không dấu và đ/đ; giao diện có hero món Việt, Lucide icons, bộ chọn và menu điều hướng dùng được trên mobile.

Block 8 bổ sung xác thực server-side bằng session/cookie, đăng ký và kích hoạt OTP, CAPTCHA, đăng nhập, đặt lại mật khẩu, CSRF và rate limit. Các trang auth được render bằng EJS; API và SPA dùng cùng origin. Đây là dự án học tập, không phải cấu hình production đã được chứng nhận.

## 1. Công nghệ và cấu trúc

| Thành phần | Công nghệ |
| --- | --- |
| `web/` | React 18, React Router 6, Vite 5, `lucide-react` |
| `api/` | Express 4, Prisma 5, PostgreSQL, EJS, express-session |
| Database | PostgreSQL; có thể dùng Supabase PostgreSQL |

```text
api/
  src/                 # API, auth routes/services/middleware và Prisma client
  prisma/              # schema, auth migration và các script seed
  views/auth/          # Auth pages rendered by EJS
  public/              # Auth-only static assets
  tests/               # API, auth và search tests
web/
  src/                 # SPA routes, views, components và apiClient.js
  public/              # CSS, ảnh và font local
  tests/               # Unit test và browser regression scripts
docs/                  # Auth policy, flows và verification checklist
package.json           # Root scripts chuyển tiếp vào api/ hoặc web/
```

Root không khai báo npm workspaces. Cài dependency riêng cho `api/` và `web/`; `npm install` ở root không cài thay cho hai ứng dụng.

## 2. Điều kiện môi trường

- Git, Node.js và npm; các lệnh bên dưới dùng PowerShell trên Windows.
- PostgreSQL truy cập được, hoặc Supabase với chuỗi kết nối PostgreSQL hợp lệ.
- SMTP để gửi email thật. Nếu không cấu hình SMTP, ứng dụng dùng tài khoản Ethereal và chỉ log link preview.
- Browser test cần Chrome và Playwright. Các suite mock/unit không cần database thật.

## 3. Cài đặt và cấu hình

Chạy các lệnh từ thư mục gốc repository:

```powershell
npm.cmd --prefix api ci
npm.cmd --prefix web ci
npm.cmd --prefix api run db:generate
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath .env.example -Destination .env
}
```

Mở `.env` và thay các placeholder trong [.env.example](.env.example). Cấu hình tối thiểu gồm `DATABASE_URL`, `SESSION_SECRET` và `OTP_PEPPER`; dùng hai secret ngẫu nhiên, độc lập, ít nhất 32 bytes. Không commit `.env`, mật khẩu hoặc chuỗi kết nối thật. Nếu cần kết nối session store trực tiếp thay vì qua pooler, cấu hình `SESSION_DATABASE_URL`/`DIRECT_URL` theo hướng dẫn trong `.env.example`.

Đặt `APP_ORIGIN` đúng origin của trình duyệt (mặc định local là `http://localhost:5173`). Production phải dùng HTTPS và cấu hình `APP_BASE_URL`, `APP_ORIGIN`, `NODE_ENV=production` cùng `TRUST_PROXY` theo reverse proxy thực tế. Không bật CORS cho SPA: Vite proxy giữ API/auth cùng origin.

## 4. Database và seed

Generate Prisma Client không cập nhật schema/dữ liệu:

```powershell
npm.cmd --prefix api run db:generate
```

Chỉ áp migration auth riêng, không reset hoặc seed lại dữ liệu Block 7:

```powershell
npm.cmd run migrate:auth
```

Nếu migration tìm kiếm Block 7 chưa được áp dụng, chạy `npm.cmd run migrate:block7` riêng. Migration này idempotent. Không chạy `db:push` hoặc reset tùy tiện trên database có dữ liệu; xác nhận database đích và sao lưu trước mọi thay đổi schema.

Tạo/refresh tài khoản viewer cho môi trường development:

```powershell
$env:SEED_USER_EMAIL="viewer@example.test"
$env:SEED_USER_PASSWORD="ChangeThis123"
npm.cmd run seed:auth
```

Auth seed chỉ cập nhật user auth. **Seed Block 7 hiện có (`npm.cmd run seed:api`) xóa toàn bộ món ăn, đầu bếp và nguyên liệu cũ rồi tạo lại dữ liệu mẫu**; chỉ chạy trên database thử nghiệm khi chủ động cho phép thay dữ liệu. `api/prisma/seed_ingredients.js` cũng ghi dữ liệu, không phải bước bắt buộc.

## 5. Chạy ứng dụng

Mở hai PowerShell terminal tại thư mục gốc:

**Terminal 1 — backend:**

```powershell
npm.cmd run dev
```

**Terminal 2 — Vite frontend:**

```powershell
npm.cmd run dev:web
```

Mở **http://localhost:5173**. Vite proxy `/api` và auth routes sang Express, kiểm tra session trước khi phục vụ SPA. Dùng `localhost` nhất quán; `127.0.0.1` là origin khác. Nếu cổng 5173 bận, dừng server do bạn quản lý hoặc chạy Vite với `--strictPort`; không dùng ngay cổng khác vì `APP_ORIGIN` cũng phải khớp. Dừng đúng các server bạn đã khởi chạy bằng Ctrl+C.

### Đường dẫn SPA chính

| URL frontend | Nội dung |
| --- | --- |
| `/`, `/dishes` | Thực đơn, hero, tìm món và lọc phân loại |
| `/dishes/:id` | Chi tiết món |
| `/admin`, `/admin/dishes` | Quản lý món, lọc trạng thái và sắp xếp giá |
| `/admin/dishes/new` | Tạo món, chọn đầu bếp/nguyên liệu |
| `/admin/dishes/:id/edit`, `/admin/dishes/:id/delete` | Sửa hoặc xác nhận xóa món |
| `/admin/chefs`, `/admin/ingredients` | Quản lý đầu bếp và kho nguyên liệu |
| `/admin/chefs/new`, `/admin/ingredients/new` | Tạo đầu bếp/nguyên liệu |
| `/admin/chefs/:id/edit`, `/admin/ingredients/:id/edit` | Sửa đầu bếp/nguyên liệu; thay `edit` bằng `delete` để mở xác nhận xóa |

Thay `:id` bằng ID thật từ danh sách. API Block 7 tương ứng gồm `/api/dishes`, `/api/chefs`, `/api/ingredients`, hỗ trợ GET danh sách/chi tiết, POST, PATCH và DELETE. Nguyên liệu đang được món ăn sử dụng không thể xóa trực tiếp. API và SPA yêu cầu session đăng nhập; unauthenticated browser request được chuyển tới `/login`.

Auth pages: `/register`, `/activate`, `/login`, `/forgot`, `/reset`. Xem đầy đủ flow, policy, cấu hình và các bước nghiệm thu trong [docs/flows.md](docs/flows.md), [docs/auth-policy.md](docs/auth-policy.md) và [docs/VERIFY.md](docs/VERIFY.md).

## 6. Kiểm thử

```powershell
npm.cmd run test:api
npm.cmd run test:auth
npm.cmd --prefix api run test:search
npm.cmd run verify:block7
npm.cmd --prefix web test
npm.cmd run build:web
```

`test:search` và `verify:block7` cần database đã migrate, dữ liệu Block 7 (1,000+ món) và seed user đang active. API integration tests tự skip khi không có `DATABASE_URL`; auth policy/crypto và SPA unit tests không cần database. Playwright scripts cần Chrome, Playwright, cặp API/Vite đang chạy và seed account; xem biến môi trường và lệnh chạy trong [docs/VERIFY.md](docs/VERIFY.md).

## 7. Build và production

```powershell
npm.cmd run build:web
npm.cmd run start:api
```

Express phục vụ `web/dist` sau khi xác thực session; hãy triển khai API, SPA và auth cùng origin qua HTTPS. `npm.cmd --prefix web run preview` chỉ phù hợp để xem frontend build độc lập, không thay thế Express/auth/database và không phải deployment path của ứng dụng.

## 8. Tài liệu và lựa chọn công nghệ

- [docs/auth-policy.md](docs/auth-policy.md): cấu hình bảo mật và giới hạn.
- [docs/flows.md](docs/flows.md): luồng đăng ký, kích hoạt, đăng nhập và reset.
- [docs/VERIFY.md](docs/VERIFY.md): acceptance checklist và trạng thái validation.
- [tech-choice.md](tech-choice.md): quyết định kiến trúc và các điểm khác so với Block 7.
