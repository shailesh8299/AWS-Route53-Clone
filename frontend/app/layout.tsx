import "./globals.css";
import { ToastProvider } from "../components/toast-context";

export const metadata = {
  title: "AWS Route53 Clone",
  description: "A functional Route53-style hosted zone and DNS record manager",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <div className="app-bg">{children}</div>
        </ToastProvider>
      </body>
    </html>
  );
}
