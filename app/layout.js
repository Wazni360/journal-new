import { Newsreader } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

export const metadata = {
  title: "Journal",
  description: "Private video journal",
};

const RootLayout = ({ children }) => (
  <html lang="en" className={`${newsreader.variable} h-full`}>
    <body className="min-h-full">{children}</body>
  </html>
);

export default RootLayout;
