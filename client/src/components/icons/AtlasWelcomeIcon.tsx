import * as React from 'react';

export const AtlasWelcomeIcon = React.forwardRef<
  SVGSVGElement,
  React.SVGProps<SVGSVGElement>
>((props, ref) => {
  const gradientId = React.useId();
  const highlightId = React.useId();

  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" {...props}>
      <defs>
        <radialGradient id={`${gradientId}-os-welcome-globe`} cx="35%" cy="30%" r="85%">
          <stop offset="0%" stopColor="#2455EB" />
          <stop offset="100%" stopColor="#1446DB" />
        </radialGradient>
        <linearGradient id={`${highlightId}-os-welcome-highlight`} x1="24" x2="92" y1="28" y2="104">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="45%" stopColor="#FFFFFF" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g fill="none" fillRule="evenodd">
        <circle cx={64} cy={64} r={56} fill={`url(#${gradientId}-os-welcome-globe)`} />
        <path
          d="M64 22c-23.196 0-42 18.804-42 42s18.804 42 42 42 42-18.804 42-42-18.804-42-42-42Z"
          stroke="#91A9FF"
          strokeWidth={3}
          opacity={0.55}
        />
        <path
          d="M64 24c-8.572 6.923-13 19.266-13 40s4.428 33.077 13 40c8.572-6.923 13-19.266 13-40S72.572 30.923 64 24Z"
          stroke="#D6E0FF"
          strokeWidth={3}
          opacity={0.75}
          strokeLinecap="round"
        />
        <path
          d="M38 30c-5.76 6.703-9 16.454-9 27.863 0 20.226 15.625 36.6 35 36.6s35-16.374 35-36.6C99 46.454 95.76 36.703 90 30"
          stroke="#D6E0FF"
          strokeWidth={3}
          opacity={0.55}
          strokeLinecap="round"
        />
        <path
          d="M28 54c10.168 6.07 21.69 9.105 36 9.105 14.31 0 25.832-3.035 36-9.105"
          stroke="#F3F6FF"
          strokeWidth={3}
          opacity={0.75}
          strokeLinecap="round"
        />
        <path
          d="M28 74c10.168-6.07 21.69-9.105 36-9.105 14.31 0 25.832 3.035 36 9.105"
          stroke="#F3F6FF"
          strokeWidth={3}
          opacity={0.6}
          strokeLinecap="round"
        />
        <path
          d="M36 96c8.672-5.88 19.512-9 28-9 8.488 0 19.328 3.12 28 9"
          stroke="#AEC1FF"
          strokeWidth={3}
          opacity={0.55}
          strokeLinecap="round"
        />
        <path
          d="M64 8c31.431 0 56 24.569 56 56 0 13.6-4.819 26.078-12.845 35.75L64 120 20.845 99.75C12.819 90.078 8 77.6 8 64 8 32.569 32.569 8 64 8Z"
          fill={`url(#${highlightId}-os-welcome-highlight)`}
        />
        <path
          fill="#FFFFFF"
          d="M64 36c-2.232 0-4.248 1.346-5.12 3.418l-17.152 40.3c-.868 2.044.152 4.4 2.196 5.268.506.215 1.045.326 1.59.326h7.092c1.73 0 3.287-1.037 3.96-2.632L58.3 74h11.4l1.734 4.68c.673 1.595 2.23 2.632 3.96 2.632h7.092c2.23 0 4.04-1.81 4.04-4.04 0-.545-.111-1.084-.326-1.59L68.88 39.418C68.008 37.346 65.992 36 63.76 36Zm.048 16.32L69.336 64H58.664l5.384-11.68Z"
        />
      </g>
    </svg>
  );
});

AtlasWelcomeIcon.displayName = 'AtlasWelcomeIcon';

export default AtlasWelcomeIcon;
