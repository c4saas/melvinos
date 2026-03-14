import type { SVGProps } from 'react';

import { cn } from '@/lib/utils';

interface AtlasLogoProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox'> {
  className?: string;
  size?: number | string;
}

export function AtlasLogo({ className, size = 24, ...props }: AtlasLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('inline-block text-current', className)}
      aria-hidden
      focusable="false"
      {...props}
    >
      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="3" />
      <path
        d="M24 4c6.5 0 12 9 12 20s-5.5 20-12 20-12-9-12-20 5.5-20 12-20Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 18c4.6 2.2 10.4 3.4 17 3.4S36.4 20.2 41 18m0 12c-4.6-2.2-10.4-3.4-17-3.4S11.6 27.8 7 30"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M24 11.5 34 36h-4l-2-5h-8l-2 5h-4l10-24.5Zm-3.2 14.5h6.4L24 20.6l-3.2 5.4Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default AtlasLogo;
