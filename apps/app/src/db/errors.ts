/**
 * Storage failures the UI has to tell apart.
 *
 * Their own module because every storage implementation throws them and the
 * engine catches them, so putting them with either one creates a cycle — and
 * declaring them twice would let a `catch` in the engine miss the class the
 * other store threw.
 */

/**
 * The device has no room left. Distinct from InvalidMutationError because the
 * mutation is fine — the storage is not — and the two need different advice.
 */
export class StorageFullError extends Error {
  constructor() {
    super('This device is out of space. Sync to free room, then try again.');
    this.name = 'StorageFullError';
  }
}

export class InvalidMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMutationError';
  }
}
