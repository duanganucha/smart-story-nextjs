import './globals.css';

export const metadata = {
  title: 'Smart Story AI',
  description: 'สร้างนิทานจากภาพหรือหัวข้อ ด้วย Gemini + เสียงบรรยาย',
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
