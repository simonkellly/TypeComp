import { login } from '@/engine/auth';

login().catch((error) => {
  console.error('Login failed:', error);
  process.exit(1);
});
