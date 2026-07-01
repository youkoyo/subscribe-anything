import type { MetadataRoute } from 'next';
import { APP_DESCRIPTION, APP_NAME, APP_SHORT_NAME } from '@/lib/branding';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: APP_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#06112f',
    theme_color: '#0c4bb3',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}