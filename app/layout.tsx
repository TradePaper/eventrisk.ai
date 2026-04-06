import type { Metadata } from "next";
import PostHogProvider from "./components/PostHogProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProbEdge | Sportsbook vs Prediction Markets",
  description: "Real-time comparison of sportsbook odds and prediction market probabilities",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-surface text-white antialiased">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
