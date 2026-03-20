import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arthastraai.app',
  appName: 'Arthastra',
  webDir: 'out',
  server: {
    androidScheme: 'https',
  },
};

export default config;
