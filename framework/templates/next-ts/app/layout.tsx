import type { ReactNode } from 'react';
import '../src/axf/ui/axf.css';

export const metadata = { title: '{{APP_NAME}}', description: 'Built on AmberX AXF — every visual is a hot-swappable asset.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
