import './globals.css';

export const metadata = {
  title: 'Comment Extractor',
  description: 'Export all comments from a YouTube video to a downloadable text or CSV file.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
