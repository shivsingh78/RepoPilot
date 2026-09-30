import type { ReactNode } from "react";

export const metadata = { title: "RepoPilot", description: "Verified AI repository analysis and repair" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#0b0d12", color: "#e6e8ee" }}>
        <main style={{ maxWidth: 880, margin: "0 auto", padding: "2rem 1rem" }}>{children}</main>
      </body>
    </html>
  );
}
