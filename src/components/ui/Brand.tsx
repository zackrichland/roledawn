import Link from "next/link";

type BrandProps = {
  href?: string;
  compact?: boolean;
  inverse?: boolean;
};

export function DawnMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="dawn-mark"
      viewBox="0 0 40 40"
      fill="none"
    >
      <rect width="40" height="40" rx="11" fill={inverse ? "#FFFFFF" : "#0B1020"} />
      <path
        d="M9.5 25.5c5.5-6.7 15.5-6.7 21 0"
        stroke="#FFD166"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="20" cy="18.1" r="4.25" fill="#FF6B5F" />
      <path d="M12 29h16" stroke="#85E0C5" strokeWidth="2.7" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ href = "/", compact = false, inverse = false }: BrandProps) {
  return (
    <Link className={`brand ${inverse ? "brand--inverse" : ""}`} href={href}>
      <DawnMark inverse={inverse} />
      {!compact && <span>RoleDawn</span>}
    </Link>
  );
}
