import Link from "next/link";

const base = "inline-flex items-center justify-center rounded-control px-3 py-1.5 text-sm transition-opacity duration-150 disabled:opacity-40 disabled:cursor-default";

const variants = {
  outline: "border border-line hover:border-muted",
  accent: "bg-accent text-white border border-accent hover:opacity-90",
  quiet: "text-muted hover:text-ink px-1",
};

export const Button = ({ variant = "outline", className = "", ...props }) => <button className={`${base} ${variants[variant]} ${className}`} {...props} />;

export const NavLink = ({ className = "", ...props }) => <Link className={`text-sm text-muted hover:text-ink transition-colors duration-150 ${className}`} {...props} />;

export const Page = ({ children, wide = false }) => <main className={`mx-auto px-6 pt-16 pb-24 md:pt-24 ${wide ? "max-w-[44rem]" : "max-w-[40rem]"}`}>{children}</main>;

export const Heading = ({ children, className = "" }) => <h1 className={`font-serif text-2xl font-normal tracking-tight ${className}`}>{children}</h1>;

export const Status = ({ children, tone = "muted", className = "" }) => (
  <p className={`text-sm ${tone === "ok" ? "text-ok" : tone === "accent" ? "text-accent" : "text-muted"} ${className}`}>{children}</p>
);
