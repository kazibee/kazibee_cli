import { createCliInstance } from '../create-instance.js';

export async function toolRemove(name: string, options: { global?: boolean }): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    const { removed } = kazi.tools.remove(name, directory);

    if (removed) {
      console.log(`Tool "${name}" removed from ${directory === '/' ? 'global' : directory}`);
    } else {
      console.error(`Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
      process.exit(1);
    }
  } finally {
    kazi.close();
  }
}
