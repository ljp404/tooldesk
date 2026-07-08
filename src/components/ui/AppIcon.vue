<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  name: string;
}>();

const isImageIcon = computed(() => {
  if (props.name.startsWith('tooldesk-plugin://')) {
    return true;
  }

  if (props.name.startsWith('data:image/')) {
    return true;
  }

  return /\.(?:svg|png|webp|jpe?g|ico)(?:[?#].*)?$/i.test(props.name);
});
</script>

<template>
  <img v-if="isImageIcon" class="app-icon app-icon-image" :src="name" alt="" aria-hidden="true" draggable="false" />
  <svg v-else class="app-icon" aria-hidden="true" viewBox="0 0 24 24">
    <template v-if="name === 'toolbox'">
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6.5 10.5V19h11v-8.5" />
    </template>
    <template v-else-if="name === 'recent'">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v4l2.5 1.5" />
    </template>
    <template v-else-if="name === 'favorite'">
      <path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z" />
    </template>
    <template v-else-if="name === 'favorite-filled'">
      <path
        d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"
        fill="currentColor"
      />
    </template>
    <template v-else-if="name === 'bookmark'">
      <path d="M7 4.5A2.5 2.5 0 0 1 9.5 2h5A2.5 2.5 0 0 1 17 4.5V21l-5-3-5 3z" />
      <path d="M10 6h4" />
    </template>
    <template v-else-if="name === 'all'">
      <path d="M9 9H7.5a2.5 2.5 0 1 1 2.5-2.5V17.5A2.5 2.5 0 1 1 7.5 15H15" />
      <path d="M15 9h1.5A2.5 2.5 0 1 0 14 6.5V17.5A2.5 2.5 0 1 0 16.5 15H9" />
    </template>
    <template v-else-if="name === 'text'">
      <path d="M7 7h10" />
      <path d="M12 7v8" />
      <path d="M9 15h6" />
    </template>
    <template v-else-if="name === 'code'">
      <path d="m9 8-4 4 4 4" />
      <path d="m15 8 4 4-4 4" />
    </template>
    <template v-else-if="name === 'image'">
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="m8 16 3-3 2 2 2.5-3 2.5 4" />
      <circle cx="9" cy="9" r="1" />
    </template>
    <template v-else-if="name === 'document'">
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v5h4" />
      <path d="M9.5 12h5" />
      <path d="M9.5 15h5" />
      <path d="M9.5 18h3" />
    </template>
    <template v-else-if="name === 'file-text'">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M10 13h4" />
      <path d="M10 17h4" />
    </template>
    <template v-else-if="name === 'json'">
      <path d="M9 7H7v10h2" />
      <path d="M15 7h2v10h-2" />
    </template>
    <template v-else-if="name === 'diff'">
      <path d="M6 7h9" />
      <path d="M6 12h12" />
      <path d="M6 17h7" />
    </template>
    <template v-else-if="name === 'hidden'">
      <path d="M6 8h12" />
      <path d="M12 8v8" />
      <path d="M9 16h6" />
      <path d="M4 4l16 16" />
    </template>
    <template v-else-if="name === 'timestamp'">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </template>
    <template v-else-if="name === 'calendar'">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
      <path d="M8 14h2" />
      <path d="M14 14h2" />
      <path d="M8 17h2" />
    </template>
    <template v-else-if="name === 'id-card'">
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M8 10h4" />
      <path d="M8 14h8" />
      <circle cx="15.5" cy="10.5" r="1.5" />
    </template>
    <template v-else-if="name === 'bank-card'">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
      <path d="M14 15h3" />
    </template>
    <template v-else-if="name === 'clipboard'">
      <rect x="7" y="4" width="10" height="14" rx="2" />
      <rect x="5" y="2" width="14" height="4" rx="1" />
    </template>
    <template v-else-if="name === 'screenshot'">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M4 16h16" />
      <path d="m15 8 3-2v6l-3-2" />
    </template>
    <template v-else-if="name === 'scroll-capture'">
      <path d="M7.5 7v9.5" />
      <path d="m4.75 13.75 2.75 2.75 2.75-2.75" />
      <path d="M16.5 17v-9.5" />
      <path d="m13.75 10.25 2.75-2.75 2.75 2.75" />
    </template>
    <template v-else-if="name === 'record'">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'stop'">
      <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'http'">
      <path d="M4 7h16" />
      <path d="M4 12h10" />
      <path d="M4 17h7" />
      <path d="m14 10 6-3v10l-6-3" />
    </template>
    <template v-else-if="name === 'network'">
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16" />
      <path d="M12 4a12 12 0 0 1 0 16" />
      <path d="M12 4a12 12 0 0 0 0 16" />
    </template>
    <template v-else-if="name === 'icp'">
      <path d="M12 3 5 6v5c0 4.2 2.8 7.8 7 10 4.2-2.2 7-5.8 7-10V6z" />
      <path d="M9 12h6" />
      <path d="M9 15h4" />
      <path d="M10 9h4" />
    </template>
    <template v-else-if="name === 'qr'">
      <rect x="5" y="5" width="5" height="5" rx="1" />
      <rect x="14" y="5" width="5" height="5" rx="1" />
      <rect x="5" y="14" width="5" height="5" rx="1" />
      <path d="M14 14h2v2h-2z" />
      <path d="M18 14h1v5h-5v-1" />
    </template>
    <template v-else-if="name === 'copy'">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </template>
    <template v-else-if="name === 'download'">
      <path d="M12 6v9" />
      <path d="m8.5 11 3.5 3.5 3.5-3.5" />
      <path d="M7 18h10" />
    </template>
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="m5.6 5.6 1.4 1.4" />
      <path d="m17 17 1.4 1.4" />
      <path d="m18.4 5.6-1.4 1.4" />
      <path d="m7 17-1.4 1.4" />
    </template>
    <template v-else-if="name === 'moon'">
      <path d="M18 15.5A7 7 0 0 1 8.5 6 6.8 6.8 0 1 0 18 15.5Z" />
    </template>
    <template v-else-if="name === 'settings'">
      <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.2a2 2 0 0 1-2 0l-.1-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.1.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.1.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.1-.1a2 2 0 0 1 2 0l.4.2a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.2a2 2 0 0 1 2 0l.1.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.1-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.1-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.1.1a2 2 0 0 1-2 0l-.4-.2a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </template>
    <template v-else-if="name === 'edit'">
      <path d="M4 20h4l9.5-9.5a2.1 2.1 0 0 0-3-3L5 17v3" />
      <path d="m13.5 6.5 3 3" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="M8 8l8 8" />
      <path d="m16 8-8 8" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <path d="m7 10 5 5 5-5" />
    </template>
    <template v-else-if="name === 'folder'">
      <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </template>
    <template v-else-if="name === 'pin'">
      <g transform="translate(12 12) scale(0.88) translate(-12 -12)">
        <path d="M12 17v4" />
        <path
          d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
        />
      </g>
    </template>
    <template v-else-if="name === 'ocr'">
      <path d="M7 7h10" />
      <path d="M9 7v8" />
      <path d="M15 7v8" />
      <path d="M8 15h8" />
      <path d="M6 17h12" />
    </template>
    <template v-else-if="name === 'translate'">
      <path d="M5 8V5h3" />
      <path d="M5 16v3h3" />
      <path d="M16 5h3v3" />
      <path d="M19 16v3h-3" />
      <path d="M9 9h6" />
      <path d="M12 7v2" />
      <path d="M8.5 12h7" />
      <path d="M10 12c.8 1.8 2.1 3 4 3.8" />
      <path d="M14 12c-.8 1.8-2.1 3-4 3.8" />
    </template>
    <template v-else-if="name === 'translate-swap'">
      <path d="M7 7h10" />
      <path d="M14 4l3 3-3 3" />
      <path d="M17 17H7" />
      <path d="M10 14l-3 3 3 3" />
    </template>
    <template v-else-if="name === 'codec'">
      <path d="M7 8h4" />
      <path d="M9 8v4" />
      <path d="M13 8h4" />
      <path d="M15 8v4" />
      <path d="M7 15h10" />
    </template>
    <template v-else-if="name === 'regex'">
      <path d="M6 8h3" />
      <path d="M7.5 8v3" />
      <path d="M12 8c2 0 3.5 1.2 3.5 3.5S14 15 12 15" />
      <path d="M12 11.5h2.5" />
      <path d="M17 8v7" />
    </template>
    <template v-else-if="name === 'cron'">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 8v4l2.5 1.5" />
      <path d="M8 6h1" />
      <path d="M15 6h1" />
    </template>
    <template v-else-if="name === 'calculator'">
      <rect x="5.5" y="4.5" width="13" height="15" rx="2" />
      <path d="M8 8.5h8" />
      <path d="M8 12h2.5" />
      <path d="M13.5 12h2.5" />
      <path d="M8 15.5h2.5" />
      <path d="M13.5 15.5h2.5" />
    </template>
    <template v-else-if="name === 'music'">
      <path d="M9 18V7l10-3v11" />
      <circle cx="7" cy="18" r="2.5" />
      <circle cx="17" cy="15" r="2.5" />
    </template>
    <template v-else-if="name === 'play'">
      <path d="M8 6.5v11l9-5.5z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'pause'">
      <path d="M8 7h3v10H8z" fill="currentColor" stroke="none" />
      <path d="M13 7h3v10h-3z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'list'">
      <path d="M8 7h10" />
      <path d="M8 12h10" />
      <path d="M8 17h10" />
      <path d="M5 7h.01" />
      <path d="M5 12h.01" />
      <path d="M5 17h.01" />
    </template>
    <template v-else-if="name === 'cloud'">
      <path d="M7 18h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.8A3.5 3.5 0 0 0 7 18z" />
    </template>
    <template v-else-if="name === 'info'">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 10v5" />
      <path d="M12 7h.01" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="m8 12 2.5 2.5L16 9" />
    </template>
    <template v-else-if="name === 'volume'">
      <path d="M8 9H6v6h2l5 4V5z" />
      <path d="M16 9a3 3 0 0 1 0 6" />
    </template>
    <template v-else-if="name === 'skip-back'">
      <path d="M6 7v10" />
      <path d="m16 8-6 4 6 4z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'skip-forward'">
      <path d="M8 8l6 4-6 4z" fill="currentColor" stroke="none" />
      <path d="M18 7v10" />
    </template>
    <template v-else-if="name === 'repeat'">
      <path d="M7 7h8a3 3 0 0 1 3 3v2" />
      <path d="M17 7v4h-4" />
      <path d="M17 17H9a3 3 0 0 1-3-3v-2" />
      <path d="M7 17v-4h4" />
    </template>
    <template v-else-if="name === 'shuffle'">
      <path d="m16 7 4 4-4 4" />
      <path d="M20 11H8" />
      <path d="m8 17-4-4 4-4" />
      <path d="M4 13h12" />
    </template>
    <template v-else-if="name === 'loader'">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </template>
    <template v-else-if="name === 'refresh'">
      <path d="M4 7V4h3" />
      <path d="M20 17v3h-3" />
      <path d="M20 7A8 8 0 0 0 6.3 6.3L4 9" />
      <path d="M4 17a8 8 0 0 0 13.7 1.7L20 15" />
    </template>
    <template v-else-if="name === 'log-out'">
      <path d="M10 7V5a2 2 0 0 1 2-2h6v16h-6a2 2 0 0 1-2-2v-2" />
      <path d="M4 12h8" />
      <path d="m7 9-3 3 3 3" />
    </template>
    <template v-else-if="name === 'arrow-left'">
      <path d="M11 7l-4 4 4 4" />
      <path d="M7 11h10" />
    </template>
    <template v-else-if="name === 'qrcode'">
      <rect x="5" y="5" width="5" height="5" rx="1" />
      <rect x="14" y="5" width="5" height="5" rx="1" />
      <rect x="5" y="14" width="5" height="5" rx="1" />
      <path d="M14 14h2v2h-2z" />
      <path d="M18 14h1v5h-5v-1" />
    </template>
    <template v-else-if="name === 'user'">
      <circle cx="12" cy="8" r="3" />
      <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
    </template>
    <template v-else-if="name === 'key'">
      <path d="M15 7a4 4 0 1 1 0 8" />
      <circle cx="11" cy="11" r="4" />
      <path d="m15 11 6-6" />
      <path d="M18 2v3" />
      <path d="M21 5h-3" />
    </template>
    <template v-else-if="name === 'lock'">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </template>
    <template v-else-if="name === 'link'">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </template>
    <template v-else-if="name === 'eye'">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </template>
    <template v-else-if="name === 'eye-off'">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </template>
    <template v-else>
      <circle cx="12" cy="12" r="7" />
    </template>
  </svg>
</template>
