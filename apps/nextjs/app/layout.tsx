import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HiveDeck',
  description: 'NewsHive editorial dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: '#0f0f0f', color: '#e5e5e5', margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
