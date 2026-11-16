import { getCharacter, DEFAULT_CHARACTER_ID } from './characters.js';

export function cachedLoader(load) {
  const cache = new Map();
  return url => {
    if (!cache.has(url)) {
      const pending = Promise.resolve().then(() => load(url)).catch(error => { cache.delete(url); throw error; });
      cache.set(url, pending);
    }
    return cache.get(url);
  };
}

// Retain the old player until replacement is ready. Source geometry/textures are shared.
export class CharacterSlot {
  constructor({ load, create, attach, detach, onStatus = () => {} }) {
    Object.assign(this, { load, create, attach, detach, onStatus });
    this.view = null;
    this.requestedId = null;
    this.generation = 0;
    this.disposed = false;
  }
  async select(id) {
    const character = getCharacter(id);
    if (this.disposed || character.id === this.requestedId) return;
    this.requestedId = character.id;
    const generation = ++this.generation;
    this.onStatus({ state: 'loading', requestedId: character.id });
    let fallback = false, cause;
    for (const candidate of character.id === DEFAULT_CHARACTER_ID ? [character] : [character, getCharacter(DEFAULT_CHARACTER_ID)]) {
      try {
        const asset = await this.load(candidate.modelUrl);
        if (this.disposed || generation !== this.generation) return;
        const next = this.create(asset, candidate);
        // Put the replacement at the old transform before its first state update.
        if (next.root && this.view?.root) {
          next.root.position.copy(this.view.root.position);
          next.root.quaternion.copy(this.view.root.quaternion);
        }
        this.attach(next);
        const previous = this.view;
        this.view = next;
        if (previous) { this.detach(previous); previous.dispose(); }
        this.onStatus({ state: fallback ? 'fallback' : 'ready', requestedId: character.id, activeId: candidate.id, error: cause });
        return;
      } catch (error) {
        if (this.disposed || generation !== this.generation) return;
        cause = error;
        fallback = true;
      }
    }
    this.onStatus({ state: 'error', requestedId: character.id, activeId: this.view?.id, error: cause });
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    if (this.view) { this.detach(this.view); this.view.dispose(); this.view = null; }
  }
}
