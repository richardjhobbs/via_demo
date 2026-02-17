import "./globals.css";

export const metadata = {
  title: "VIA Demo",
  description: "Demo experience for how assistants handle a purchase from request to confirmation."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
