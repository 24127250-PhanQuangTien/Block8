# HƯỚNG DẪN KHỞI CHẠY & NGHIỆM THU DỰ ÁN (BLOCK 6: REST API & REACT SPA)

> Hướng dẫn chạy hiện tại nằm ở [README.md](README.md): cấu hình `.env` tại root, migration Block 8, seed auth và Vite same-origin proxy. Các bước CORS/dev server cũ bên dưới chỉ giữ lại làm tư liệu Block 6; ưu tiên README khi có khác biệt.

Dự án đã được chuyển đổi hoàn toàn từ phiên bản cũ (SSR) sang kiến trúc hiện đại chuẩn chỉnh theo đúng yêu cầu đề bài và 55 slide bài giảng:
* **`api/` (Backend):** REST API xây dựng bằng Node.js + Express + Prisma ORM + Supabase PostgreSQL. Chạy tại `http://localhost:3000`.
* **`web/` (Frontend):** Ứng dụng Single Page Application (SPA) xây dựng bằng **React 18 + React Router v6 + Vite**. Chạy tại `http://localhost:5173`.

---

## 1. CÁCH KHỞI CHẠY DỰ ÁN

Mở 2 cửa sổ Terminal (PowerShell):

### Terminal 1: Khởi chạy Backend API (Port 3000)
```powershell
cd D:\III_HK1\Web2\Block6\api
npm run dev
# Hoặc từ thư mục gốc: npm run dev:api
```
Server API sẽ khởi động tại: `http://localhost:3000`

### Terminal 2: Khởi chạy Frontend React SPA (Port 5173)
```powershell
cd D:\III_HK1\Web2\Block6\web
npm run dev
# Hoặc từ thư mục gốc: npm run dev:web
```
Trình duyệt mở tại: `http://localhost:5173`

---

## 2. CHẠY KIỂM THỬ TỰ ĐỘNG (AUTOMATED TESTS)

Đã tích hợp sẵn bộ kiểm thử kiểm tra tự động toàn bộ 9 tiêu chí của REST API (CORS origin, Preflight 204, Lỗi kỹ thuật 404/500, Response shape `{ ok: true, data }`, Lỗi nghiệp vụ `NOT_FOUND` và `VALIDATION_FAILED`):

```powershell
cd D:\III_HK1\Web2\Block6\api
npm test
```

---

## 3. ĐỐI CHIẾU TIÊU CHÍ NGHIỆM THU (THEO SLIDE 49 – 52)

### A. Kiểm tra Backend API (`api/`)
1. **Response Shape:** Toàn bộ các handler đều trả về cấu trúc chuẩn:
   - Thành công: `{ ok: true, data: [...] }`
   - Lỗi nghiệp vụ (Status 200): `{ ok: false, error: { code: "NOT_FOUND" | "VALIDATION_FAILED", message: "...", fields: {...} } }`
2. **CORS chặt chẽ:** Chỉ cho phép Origin của SPA `http://localhost:5173`, không dùng wildcard `*`. Hỗ trợ Preflight `OPTIONS` trả về `204 No Content` với đầy đủ methods (`GET, POST, PATCH, DELETE, OPTIONS`).
3. **Phân biệt lỗi kỹ thuật:** Gọi sai route `/api/bok` trả về HTTP `404` thuần túy (không có vỏ `ok`). Sập server/DB trả về HTTP `500` thuần túy.
4. **An toàn bảo mật:** Dữ liệu nhận từ body đều qua whitelist (chỉ lấy các trường cho phép). Tuyệt đối không để lộ chuỗi kết nối DB trong code hay log.

### B. Kiểm tra Frontend React SPA (`web/`)
1. **Không Reload trang:** Sử dụng React Router v6 với HTML5 History API. Mọi thao tác chuyển trang, bấm link, submit form, xóa bản ghi đều không làm load lại document (tab trình duyệt không bị quay vòng).
2. **Tải lại trực tiếp không lỗi (No 404):** Mở thẳng hoặc bấm F5 Reload tại bất kỳ URL nào (`/dishes/2`, `/admin/dishes/new`, `/admin/dishes/2/edit`, `/admin/dishes/2/delete`) đều hiển thị đúng trang nhờ Vite SPA fallback.
3. **Bóc tách 3 tầng lỗi:** Tập trung logic gọi API tại `apiClient.js`:
   - Tầng 1: Mất mạng hoặc bị chặn CORS $\rightarrow$ Báo lỗi kết nối.
   - Tầng 2: Status HTTP lỗi kỹ thuật (404/500) $\rightarrow$ Báo lỗi hệ thống chung.
   - Tầng 3: Lỗi nghiệp vụ `ok: false` $\rightarrow$ Đọc `error.code` và `error.fields`.
4. **Xử lý đủ 4 trạng thái UI (Slide 30, 47):**
   - `loading`: Hiện spinner khi đang nạp dữ liệu.
   - `ok`: Hiển thị danh sách hoặc chi tiết.
   - `empty`: Hiển thị thông báo khi danh sách rỗng.
   - `notFound`: Hiển thị giao diện "Không tìm thấy món" khi ID không tồn tại.
   - `error`: Hiển thị banner cảnh báo kèm nút **"Thử lại" (Retry)**.
5. **Biểu mẫu Form & Xác nhận Xóa:**
   - Khi submit form, nút bấm bị khóa (`disabled`), chặn hành vi mặc định `e.preventDefault()`.
   - Nếu `VALIDATION_FAILED`: chữ đỏ báo lỗi hiện ngay dưới từng ô input vi phạm, **giữ nguyên toàn bộ giá trị đã nhập**.
   - Lưu thành công: điều hướng client về trang danh sách.
   - Xóa: có trang xác nhận riêng (`/admin/.../:id/delete`), chỉ khi bấm nút "Xác nhận xóa" thì mới gửi request `DELETE`.
