import { installChromeFake, resetChromeFake } from './src/lib/__fakes__/chrome';
import { beforeEach } from 'vitest';

installChromeFake();
beforeEach(() => {
  resetChromeFake();
});
