import "./globals.css";

export const metadata = {
  title: "ソフトボール成績記録",
  description: "ソフトボールチームの試合記録・成績管理アプリ",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full flex flex-col bg-gray-50 font-sans text-gray-900">
        {children}
      </body>
    </html>
  );
}
