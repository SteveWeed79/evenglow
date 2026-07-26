import { handlers } from '@/server/auth/config';

// Argon2 is a native module, so this route must run on the Node runtime.
export const runtime = 'nodejs';

export const { GET, POST } = handlers;
