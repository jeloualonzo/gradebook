import { Inter } from 'next/font/google';
import './globals.css';
import StatusBar from '@/components/StatusBar';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata = {
  title: 'Faculty Gradebook',
  description: 'Offline-first gradebook for faculty use',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-gray-50 text-gray-900 min-h-screen">
        {children}
        <StatusBar />
      </body>
    </html>
  );
}
