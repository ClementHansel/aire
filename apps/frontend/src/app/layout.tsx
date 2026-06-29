import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIRE Operations Platform',
  description: 'Multi-tenant POS and operations management for car wash businesses',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
