# CodeFlow – Trình tạo sơ đồ kiến trúc & Truy vết luồng xử lý từ Source Code

> **CodeFlow** là công cụ dành cho Developer & Tech Lead giúp tự động phân tích cấu trúc mã nguồn (Frontend Vue/Nuxt, Backend Laravel, Database MySQL), truy vết toàn bộ luồng xử lý từ giao diện đến cơ sở dữ liệu và **kiểm chứng ngược về đúng file và dòng code nguồn**.

---

## 🚀 Tính năng nổi bật (v1.0 MVP)

1. **Phân tích cấu trúc đa tầng (End-to-End Tracing):**
   - **Frontend (Vue.js / Nuxt 3):** Tự động bóc tách Pages, Components, Composables, State và API Client methods.
   - **Backend (PHP Laravel):** Nhận diện Routes, Controllers (kể cả gọi qua Service hoặc gọi trực tiếp Eloquent Model), FormRequest Validations, Services (DB Transaction) và Async Queue Jobs.
   - **Database (MySQL):** Phân tích các file Migration/Schema để sinh ra danh sách bảng, kiểu dữ liệu, Primary Key, Foreign Key.
2. **5 Chế độ sơ đồ:**
   - **Flowchart tương tác (React Flow):** Kéo thả node, thêm node thủ công (`Manual`), nối dây kết nối, sửa tên/mô tả, ẩn/hiện node, đổi hướng hiển thị (TB / LR), Undo/Redo.
   - **Sequence Diagram:** Sinh sơ đồ tuần tự với đầy đủ các bước từ tương tác giao diện, gọi API, validation, transaction đến ghi DB.
   - **ERD Diagram:** Sơ đồ quan hệ thực thể MySQL chi tiết từng cột và khóa ngoại.
   - **Kiến trúc tổng thể (Architecture Overview):** Phân chia rõ ràng 3 phân lớp Frontend, Backend và Database.
   - **Truy vết 2 chiều (Code Inspector & Search):** Click vào bất kỳ node nào để xem chính xác vị trí dòng code bắt đầu/kết thúc và các thành phần liên quan. Tìm một hàm/file để thấy tất cả các sơ đồ/API gọi đến nó.
3. **Quản lý phiên bản & Export:**
   - Hỗ trợ lưu sơ đồ thành các version (`v1`, `v2`, ...) mà không làm mất kết quả phân tích gốc.
   - Hỗ trợ phân tích lại dự án khi source code thay đổi.
   - Xuất sơ đồ ra các định dạng: **SVG**, **Mermaid (`.mmd`)**, **PlantUML (`.puml`)**, **JSON Graph**.
   - Hỗ trợ chia sẻ với chế độ **Private** hoặc **Public Link**.
4. **An toàn bảo mật:**
   - Tự động bỏ qua `node_modules`, `vendor`, `dist`, `.git` và file binary.
   - Tuyệt đối không đọc các file nhạy cảm như `.env`, private key, credentials.
   - Phân tích tĩnh (Static code analysis), không thực thi mã nguồn của người dùng.

---

## 🛠 Yêu cầu hệ thống

- **Node.js:** Phiên bản 18.x trở lên (đã kiểm thử tương thích tốt trên Node v20 / v22 / v24).
- **npm** (đi kèm Node.js) hoặc **pnpm** / **yarn**.

---

## 📦 Hướng dẫn cài đặt & Chạy ứng dụng

### 1. Clone repository về máy

```bash
git clone <URL_REPOSITORY_CUA_BAN>
cd diagram-AI
```

### 2. Cài đặt các thư viện phụ thuộc

```bash
npm install
```

### 3. Khởi chạy môi trường phát triển (Development)

```bash
npm run dev
```

Mở trình duyệt và truy cập:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🧪 Dự án mẫu thử nghiệm (Sample Project)

Hệ thống được tích hợp sẵn project mẫu **ShareSpend** (Ứng dụng chia tiền nhóm viết bằng **Laravel + Vue 3/Nuxt + MySQL**) tại thư mục:
`sample-projects/sharespend`

Khi vừa mở giao diện web lên lần đầu, hệ thống sẽ tự động nạp và phân tích project mẫu này để bạn có thể:
1. Xem ngay luồng **"Tạo khoản chi tiêu mới (POST /api/expenses)"** từ Vue Form qua Laravel Controller, Validation, DB Transaction và MySQL.
2. Click vào từng node trên canvas để mở **Code Inspector** bên phải và kiểm tra đoạn code thực tế.
3. Thử tải lên một dự án khác bằng nút **"Upload ZIP / Tạo Project"** ở thanh điều hướng trên cùng.

---

## 📂 Cấu trúc thư mục chính

```text
├── sample-projects/
│   └── sharespend/        # Source code dự án mẫu Laravel + Vue + MySQL
├── src/
│   ├── app/
│   │   ├── api/projects/  # API upload ZIP, scan thư mục local, lưu diagram
│   │   ├── page.tsx       # Màn hình chính Workspace CodeFlow
│   │   └── globals.css    # Style TailwindCSS & theme dark
│   ├── components/
│   │   ├── InteractiveFlowCanvas.tsx # Canvas vẽ sơ đồ với React Flow
│   │   ├── CodeInspectorPanel.tsx    # Panel soi dòng code nguồn & truy vết
│   │   └── MermaidViewer.tsx         # Render Sequence & ERD Diagram
│   ├── lib/
│   │   ├── analyzer.ts    # Bộ Static Parser & Graph Builder (FE, BE, DB)
│   │   └── store.ts       # Storage lưu trữ project và phiên bản phân tích
│   └── types/
│       └── codeflow.ts    # Định nghĩa kiểu dữ liệu TypeScript
├── feature.md             # Tài liệu đặc tả nghiệp vụ chi tiết
├── package.json
└── README.md
```

---

## 📜 Các lệnh npm hữu ích

| Lệnh | Ý nghĩa |
|---|---|
| `npm run dev` | Khởi động server phát triển ở cổng 3000 |
| `npm run build` | Biên dịch bản build production tối ưu |
| `npm run start` | Chạy production server sau khi đã build |
| `npx tsc --noEmit` | Kiểm tra lỗi kiểu dữ liệu TypeScript toàn bộ dự án |
