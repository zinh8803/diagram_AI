import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CodeFlow – Sơ đồ kiến trúc & Truy vết luồng xử lý từ Source Code',
  description:
    'Phân tích cấu trúc dự án Frontend (Vue/Nuxt), Backend (Laravel) & MySQL, truy vết luồng xử lý từ giao diện đến database và kiểm chứng trực tiếp bằng dòng code nguồn.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" className="dark">
      <body className="min-h-screen bg-[#090d16] text-slate-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        {children}
      </body>
    </html>
  );
}
