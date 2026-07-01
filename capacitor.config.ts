import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tooldesk.app',
  appName: 'Tooldesk',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: true
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  },
  server: {
    androidScheme: 'https'
  }
};

export default config;
