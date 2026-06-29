import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/shared/ThemeProvider';
import '@/styles/tokens.css';

export const metadata: Metadata = {
  title: 'AIRE Operations Platform',
  description: 'Multi-tenant POS and operations management for car wash businesses',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
