import { Inter } from 'next/font/google';
import './globals.css';
import StatusBar from '@/components/StatusBar';
import CaseShortcut from '@/components/CaseShortcut';
import GlobalShortcuts from '@/components/GlobalShortcuts';
import ConflictWatcher from '@/components/ConflictWatcher';

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
        <CaseShortcut />
        <GlobalShortcuts />
        <ConflictWatcher />
      </body>
    </html>
  );
}
