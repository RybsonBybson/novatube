import type { SVGProps } from "react";

/**
 * Znak YouTube'a.
 *
 * lucide-react (od wersji 1.x) nie zawiera już ikon marek, dlatego glyph
 * jest osadzony jako inline SVG. Wszystkie pozostałe ikony w aplikacji
 * pochodzą z Lucide React.
 */
export function YoutubeIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.42a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33 2.78 2.78 0 0 0 1.94 2c1.72.42 8.6.42 8.6.42s6.88 0 8.6-.42a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.33 29 29 0 0 0-.46-5.33ZM9.75 15.02V8.48L15.42 11.75 9.75 15.02Z"
      />
    </svg>
  );
}
